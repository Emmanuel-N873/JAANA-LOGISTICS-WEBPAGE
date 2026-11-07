import { endpoint, HttpError, rateLimit, json, hash } from '../../server/common.js';
import { signLocation } from '../../server/location-token.js';

const LAGOS_BIAS = 'proximity:3.3792,6.5244';

function locationError(status, code, message, requestType) {
  return new HttpError(status, message, code, { requestType });
}

function validCoordinates(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function searchText(query) {
  // Adding local context helps Geoapify understand informal Lagos addresses
  // such as bus stops and landmarks without changing what the user typed.
  return /\b(?:lagos|nigeria)\b/i.test(query) ? query : `${query}, Lagos, Nigeria`;
}

export async function onRequest(context) {
  return endpoint(context, 'GET', async () => {
    const url = new URL(context.request.url);
    const hasCoordinates = url.searchParams.has('lat') || url.searchParams.has('lon');
    const requestType = hasCoordinates ? 'reverse' : 'autocomplete';
    const query = (url.searchParams.get('q') || '').trim();

    try {
      await rateLimit(context, 'locations', 60, 60);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429)
        throw locationError(
          429,
          'local_rate_limited',
          'Address lookup is temporarily rate limited. Please retry shortly.',
          requestType
        );
      throw error;
    }

    if (!hasCoordinates && (query.length < 3 || query.length > 150)) {
      throw locationError(
        400,
        'invalid_search_query',
        'Enter at least 3 characters to search for an address.',
        requestType
      );
    }

    const latitude = Number(url.searchParams.get('lat'));
    const longitude = Number(url.searchParams.get('lon'));
    const accuracy = Number(url.searchParams.get('accuracy'));
    if (hasCoordinates && !validCoordinates(latitude, longitude))
      throw locationError(
        400,
        'invalid_coordinates',
        'Your browser returned an invalid location.',
        requestType
      );
    if (hasCoordinates && url.searchParams.has('accuracy')) {
      if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000)
        throw locationError(
          400,
          'accuracy_rejected',
          'Your location is too inaccurate. Please search for the address instead.',
          requestType
        );
    }

    const apiKey = context.env.GEOAPIFY_API_KEY;

    if (!apiKey) {
      throw locationError(
        503,
        'provider_not_configured',
        'Address suggestions are temporarily unavailable.',
        requestType
      );
    }

    const geoapifyUrl = new URL(
      hasCoordinates
        ? 'https://api.geoapify.com/v1/geocode/reverse'
        : 'https://api.geoapify.com/v1/geocode/autocomplete'
    );

    if (hasCoordinates) {
      geoapifyUrl.searchParams.set('lat', String(latitude));
      geoapifyUrl.searchParams.set('lon', String(longitude));
    } else {
      geoapifyUrl.searchParams.set('text', searchText(query));
      geoapifyUrl.searchParams.set('bias', LAGOS_BIAS);
      geoapifyUrl.searchParams.set('lang', 'en');
    }
    geoapifyUrl.searchParams.set('filter', 'countrycode:ng');
    if (!hasCoordinates) geoapifyUrl.searchParams.set('limit', '5');
    geoapifyUrl.searchParams.set('apiKey', apiKey);

    // Shared daily budget protects the provider across different visitor IPs.
    const globalContext = {
      ...context,
      request: new Request(context.request.url, {
        headers: { 'CF-Connecting-IP': 'locations-global' },
      }),
    };
    const dailyLimit = Number(context.env.LOCATION_DAILY_LIMIT || 1000);
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1)
      throw locationError(
        503,
        'provider_unavailable',
        'Address suggestions are temporarily unavailable.',
        requestType
      );
    const cacheSeconds = Math.min(
      300,
      Math.max(0, Number(context.env.LOCATION_CACHE_SECONDS) || 0)
    );
    const cache = !hasCoordinates && cacheSeconds && globalThis.caches?.default;
    const cacheKey = new Request(
      new URL('/_location-cache/' + (await hash(query.toLowerCase())), context.request.url)
    );
    let cached = cache ? await cache.match(cacheKey) : null;
    let response;

    try {
      if (!cached) await rateLimit(globalContext, 'locations-daily', dailyLimit, 86400);
      response =
        cached ||
        (await fetch(geoapifyUrl, {
          signal: AbortSignal.timeout(8000),
        }));
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 429)
          throw locationError(
            429,
            'local_rate_limited',
            'Address lookup is temporarily rate limited. Please retry shortly.',
            requestType
          );
        throw error;
      }
      console.error('Address provider request failed', { errorType: error.name });
      throw locationError(
        503,
        error.name === 'TimeoutError' ? 'provider_timeout' : 'provider_unavailable',
        'Address suggestions are temporarily unavailable.',
        requestType
      );
    }

    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'provider_authentication'
          : response.status === 429
            ? 'provider_rate_limited'
            : 'provider_rejected';
      console.error('Address provider rejected request', { status: response.status, requestType });
      throw locationError(
        503,
        code,
        'Address suggestions are temporarily unavailable.',
        requestType
      );
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw locationError(
        503,
        'provider_invalid_response',
        'Address suggestions are temporarily unavailable.',
        requestType
      );
    }

    if (cache && !cached && Array.isArray(data.features)) {
      const write = cache.put(
        cacheKey,
        Response.json(data, { headers: { 'Cache-Control': 'public, max-age=' + cacheSeconds } })
      );
      if (context.waitUntil) context.waitUntil(write);
      else await write;
    }

    const candidates = (data.features || [])
      .map((feature) => feature.properties)
      .filter(
        (location) =>
          location &&
          Number.isFinite(location.lat) &&
          Number.isFinite(location.lon) &&
          (hasCoordinates ||
            (location.result_type !== 'city' &&
              location.result_type !== 'state' &&
              location.result_type !== 'country')) &&
          typeof location.country_code === 'string' &&
          location.country_code.toLowerCase() === 'ng' &&
          (hasCoordinates || !location.rank?.confidence || location.rank.confidence >= 0.3) &&
          typeof location.formatted === 'string' &&
          location.formatted.length > 0
      );

    if (hasCoordinates) {
      const location = candidates[0];
      if (!location) {
        throw locationError(
          400,
          'reverse_no_result',
          'We could not turn your current location into a Lagos address. Please search for the address instead.',
          requestType
        );
      }

      return json({
        location: {
          label: location.formatted,
          resultType: location.result_type,
          confidence: location.rank?.confidence ?? null,
          token: await signLocation(context.env, {
            label: location.formatted,
            lat: latitude,
            lon: longitude,
          }),
        },
      });
    }

    const suggestions = await Promise.all(
      candidates.map(async (location) => ({
        label: location.formatted,
        resultType: location.result_type,
        confidence: location.rank?.confidence ?? null,
        token: await signLocation(context.env, {
          label: location.formatted,
          lat: location.lat,
          lon: location.lon,
        }),
      }))
    );

    return json({ suggestions });
  });
}
