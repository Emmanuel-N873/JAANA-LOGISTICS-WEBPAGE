import { endpoint, body, text, json, HttpError, rateLimit } from '../../server/common.js';
import { pricing, estimate } from './pricing.js';
import { verifyLocation } from '../../server/location-token.js';

async function geoapifyRequest(url) {
  let response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new HttpError(503, 'The map service is unavailable. Please retry or contact JAANA on WhatsApp.');
  }

  if (!response.ok) {
    console.error('Geoapify request failed:', {
      endpoint: new URL(url).pathname,
      status: response.status
    });

    throw new HttpError(
      503,
      'The map service could not calculate your route. Please retry later.'
    );
  }

  try {
    return await response.json();
  } catch (error) {
    console.error('Geoapify JSON parsing failed:', {
      endpoint: new URL(url).pathname,
      errorType: error.name
    });

    throw new HttpError(
      503,
      'The map service returned an invalid response. Please retry later.'
    );
  }
}

async function geocode(address, apiKey) {
  const url = new URL('https://api.geoapify.com/v1/geocode/search');

  url.searchParams.set('text', address);
  url.searchParams.set('filter', 'countrycode:ng');
  url.searchParams.set('limit', '5');
  url.searchParams.set('apiKey', apiKey);

  const data = await geoapifyRequest(url);

  const location = data.features?.[0]?.properties;


  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lon)
  ) {
    throw new HttpError(
      400,
      'We could not locate one of your addresses. Please enter a more complete address.'
    );
  }

  // Avoid silently accepting a very uncertain address match.
  const confidence = location.rank?.confidence;

  if (location.result_type === 'city') {
    throw new HttpError(
      400,
      'We found the city but not the exact delivery location. Please enter a more specific street address or landmark.'
    );
  }

  if (typeof confidence === 'number' && confidence < 0.5) {
    throw new HttpError(
      400,
      'An address could not be identified confidently. Please include the street, area and city.'
    );
  }

  return { lat: location.lat, lon: location.lon };
}

export async function route(
  context,
  pickup,
  destination,
  pickupToken,
  destinationToken
) {
  const apiKey = context.env.GEOAPIFY_API_KEY;

  if (!apiKey) {
    throw new HttpError(
      503,
      'Automatic road distance is awaiting map setup. Please contact JAANA on WhatsApp.'
    );
  }

  const [origin, target] = await Promise.all([
    verifyLocation(context.env, pickupToken, pickup),
    verifyLocation(context.env, destinationToken, destination)
  ]);

  const url = new URL('https://api.geoapify.com/v1/routing');

  url.searchParams.set(
    'waypoints',
    `${origin.lat},${origin.lon}|${target.lat},${target.lon}`
  );
  url.searchParams.set('mode', 'drive');
  url.searchParams.set('apiKey', apiKey);

  const dailyLimit=Number(context.env.ROUTING_DAILY_LIMIT||1000);
  if(!Number.isSafeInteger(dailyLimit)||dailyLimit<1)throw new HttpError(503,'Routing is temporarily unavailable.');
  const globalContext={...context,request:new Request(context.request.url,{headers:{'CF-Connecting-IP':'routing-global'}})};
  await rateLimit(globalContext,'routing-daily',dailyLimit,86400);
  const data = await geoapifyRequest(url);

  const meters = data.features?.[0]?.properties?.distance;

  if (!Number.isFinite(meters) || meters <= 0) {
    throw new HttpError(
      400,
      'No driving route was found. Please check your pickup and delivery addresses.'
    );
  }

  return meters / 1000;
}

export async function onRequest(context) {
  return endpoint(context, 'POST', async () => {
    await rateLimit(context, 'route', 20, 600);

    const data = await body(context.request);

    const pickup = text(data, 'pickup', 500);
    const destination = text(data, 'destination', 500);
    const weight = Number(data.weight);

    if (!Number.isFinite(weight) || weight <= 0 || weight > 10000) {
      throw new HttpError(400, 'Enter a valid combined weight.');
    }

    const distanceKm = await route(
      context,
      pickup,
      destination,
      data.pickupToken,
      data.destinationToken
    );
    const rates = await pricing(context);

    return json({
      distanceKm,
      rates,
      ...estimate(distanceKm, weight, rates)
    });
  });
}
