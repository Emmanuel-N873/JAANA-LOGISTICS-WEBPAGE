import { endpoint, HttpError, rateLimit } from '../../server/common.js';
import { signLocation } from '../../server/location-token.js';

export async function onRequest(context) {
  return endpoint(context, 'GET', async () => {
    await rateLimit(context, 'locations', 60, 60);

    const url = new URL(context.request.url);
    const query = (url.searchParams.get('q') || '').trim();

    if (query.length < 3 || query.length > 150) {
      throw new HttpError(400, 'Enter at least 3 characters to search for an address.');
    }

    const apiKey = context.env.GEOAPIFY_API_KEY;

    if (!apiKey) {
      throw new HttpError(503, 'Address suggestions are temporarily unavailable.');
    }

    const geoapifyUrl = new URL(
      'https://api.geoapify.com/v1/geocode/autocomplete'
    );

    geoapifyUrl.searchParams.set('text', query);
    geoapifyUrl.searchParams.set('filter', 'countrycode:ng');
    geoapifyUrl.searchParams.set('limit', '5');
    geoapifyUrl.searchParams.set('apiKey', apiKey);

    let response;

    try {
      response = await fetch(geoapifyUrl, {
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new HttpError(503, 'Address suggestions are temporarily unavailable.');
    }

    if (!response.ok) {
      throw new HttpError(503, 'Address suggestions are temporarily unavailable.');
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw new HttpError(503, 'Address suggestions are temporarily unavailable.');
    }

    const candidates = (data.features || [])
      .map(feature => feature.properties)
      .filter(location =>
        location &&
        Number.isFinite(location.lat) &&
        Number.isFinite(location.lon) &&
        location.result_type !== 'city' &&
        location.result_type !== 'state' &&
        location.result_type !== 'country' &&
        location.country_code === 'ng' &&
        typeof location.rank?.confidence === 'number' &&
        location.rank.confidence >= 0.5 &&
        typeof location.formatted === 'string' &&
        location.formatted.length > 0
      );

    const suggestions = await Promise.all(
      candidates.map(async location => ({
        label: location.formatted,
        resultType: location.result_type,
        confidence: location.rank.confidence,
        token: await signLocation(context.env, {
          label: location.formatted,
          lat: location.lat,
          lon: location.lon
        })
      }))
    );


    return Response.json({ suggestions });
  });
}
