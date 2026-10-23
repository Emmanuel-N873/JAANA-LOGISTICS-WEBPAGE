import { endpoint, HttpError, rateLimit, json, hash } from '../../server/common.js';
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

    // Shared daily budget protects the provider across different visitor IPs.
    const globalContext={...context,request:new Request(context.request.url,{headers:{'CF-Connecting-IP':'locations-global'}})};
    const dailyLimit=Number(context.env.LOCATION_DAILY_LIMIT||1000);
    if(!Number.isSafeInteger(dailyLimit)||dailyLimit<1)throw new HttpError(503,'Address suggestions are temporarily unavailable.');
    const cacheSeconds=Math.min(300,Math.max(0,Number(context.env.LOCATION_CACHE_SECONDS)||0));
    const cache=cacheSeconds&&globalThis.caches?.default;
    const cacheKey=new Request(new URL('/_location-cache/'+await hash(query.toLowerCase()),context.request.url));
    let cached=cache?await cache.match(cacheKey):null;
    let response;

    try {
      if(!cached)await rateLimit(globalContext,'locations-daily',dailyLimit,86400);
      response = cached || await fetch(geoapifyUrl, {
        signal: AbortSignal.timeout(8000)
      });
    } catch(error) {
      if(error instanceof HttpError)throw error;
      console.error('Address provider request failed',{errorType:error.name});
      throw new HttpError(503, 'Address suggestions are temporarily unavailable.');
    }

    if (!response.ok) {
      console.error('Address provider rejected request',{status:response.status});
      throw new HttpError(503, 'Address suggestions are temporarily unavailable.');
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw new HttpError(503, 'Address suggestions are temporarily unavailable.');
    }

    if(cache&&!cached&&Array.isArray(data.features)){const write=cache.put(cacheKey,Response.json(data,{headers:{'Cache-Control':'public, max-age='+cacheSeconds}}));if(context.waitUntil)context.waitUntil(write);else await write;}

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


    return json({ suggestions });
  });
}
