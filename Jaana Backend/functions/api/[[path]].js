import { json } from '../../server/common.js';
export function onRequest() { return json({ error: 'API endpoint not found.' }, 404); }
