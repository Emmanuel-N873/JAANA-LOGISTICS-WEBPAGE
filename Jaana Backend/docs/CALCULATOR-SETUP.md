# Delivery calculator setup

The separate calculator.html page transfers shipment fields through session storage to the original Book a Delivery template on index.html#booking. Homepage booking buttons lead to calculator.html. The booking opens as a dialog. Saved orders include package count, weight and server-calculated pricing in shipment_json; staff can inspect these in order details.

1. Apply migrations, including 0004_pricing.sql: `npx wrangler d1 migrations apply DB --remote` from Jaana Backend (use --local for development).
2. Create a Geoapify API key. Add GEOAPIFY_API_KEY as a Cloudflare Pages secret (or in untracked .dev.vars locally). Never put this secret in browser JavaScript. Set appropriate provider quotas.
3. Rebuild with `npm run build` and deploy through the existing Cloudflare Pages workflow. No deployment is performed by these local changes.
4. Sign in to admin.html as an administrator and choose Delivery pricing to change the per-kilometre rate and minimum distance charge. Changes are audited and apply to new estimates.

Full street addresses are sent to Geoapify for Nigeria-filtered geocoding and driving road distance. A Google Maps route link lets the customer inspect the addresses and route. This is on-demand road routing, not live rider GPS tracking. If the provider is unavailable, the calculator shows a clear error and does not fabricate a distance or price. WhatsApp remains available at +2348038422591.

Pricing: max(minimum, ceil(kilometres × rate)) + weight charge. Weight tiers are 0 / 500 / 1000 / 1500 naira through 5 / 10 / 15 / 20 kg respectively. Above 20 kg the total is null and requires a custom quotation. The booking endpoint recalculates any quoted route and price, so customer-submitted prices are never authoritative.
