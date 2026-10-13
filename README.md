# JAANA Logistics homepage

A responsive, buildless homepage based on `image/JAANA Logistics Delivery Homepage.png`.

## Run locally

Open `index.html` in a modern browser. No installation, build process or external image service is required.

## Files

- `index.html`: semantic page sections, SVG icons, navigation and accessible dialogs.
- `design-system.css`: shared colours, typography, layout primitives and buttons.
- `styles.css`: section layouts, responsive rules and reference-image windows.
- `script.js`: mobile navigation, service slideshow, dialogs and WhatsApp request composition.
- `image/JAANA Logistics Delivery Homepage.png`: retained original design reference; the live page no longer crops artwork from it.
- `image/hero-delivery.jpg`: independent generated hero scene with no embedded branding or captions; generation prompt in `image/hero-prompt.txt`.
- `image/lagos-coverage.svg`: independent schematic coverage illustration. The adjoining area list provides the actual served-area information.
- `image/services/`: five dedicated 1672 × 941 service images, optimised as JPEGs, plus the generation prompts in `prompts.md`. These are generated illustrations of delivery scenarios, not photographs of actual JAANA personnel or facilities.
- `image/JAANA Logistics About Us Infographic.png`: retained source reference; About Us now uses readable HTML content.
- `image/Company Logo.jpeg`: company logo displayed in the header and footer. CSS crops its surrounding white margins without modifying the original.

## Favicon

The favicon uses the blue-and-gold parcel box from the company logo, with the wordmark and running legs removed. `favicon.ico` includes 16, 32, 48 and 256 pixel frames; matching PNGs and a 180 pixel Apple touch icon are in `image/`. The transparent master is `image/favicon-source.png`. It was produced with the built-in imagegen tool; its extraction prompt is saved in `image/favicon-prompt.txt`.

## Delivery requests

Booking, quotation and package status forms validate their fields and open a prefilled WhatsApp conversation with `+2348038422591`. Visitors review and send the message themselves. Requests are not stored by this page, and a booking is confirmed by the company rather than by submitting the form.

There is no live tracking API or backend. The feature is consistently labelled Delivery Updates and requests a status update from the team through WhatsApp.

The user confirmed the company details, coverage and displayed delivery/customer/partner statistics on 13 October 2026. Public contact details are `0907 257 3328`, WhatsApp `0803 842 2591`, `jaanadelivery@gmail.com`, and No. 20 Oyin Onibokun Crescent, Isheri-Osun, Lagos 102214. Confirmed working hours are Monday–Saturday, 9:00am–5:00pm, West Africa Time (Africa/Lagos). This records user confirmation, not an independent audit of the statistics.

Booking requests include the service type, preferred delivery date, recipient name and phone number, approximate package size, sender contact, pickup/delivery addresses and package details. Date validation uses the current day in Lagos and rejects past dates and Sundays. The requested date, availability, pickup timing, price and booking are confirmed by the company. No automatic reservation or payment is performed.

Facebook, Instagram and X footer icons link to the supplied company profiles. The WhatsApp icon opens a conversation with `+2348038422591`. All four links open in new tabs.

## Design and accessibility

The five delivery services appear in a full-width slideshow, one photograph at a time, with an overlaid title and description. Slides advance every two seconds, with a 650 millisecond sliding transition. Previous/next arrows, slide selectors, left/right keyboard arrows and touch swiping allow manual selection. Manual selection pauses rotation; the Play slideshow button resumes it. Rotation also pauses while hovered, focused or in a hidden browser tab. Reduced-motion preferences disable automatic rotation by default and remove slide animation. Service navigation links select the matching slide.

Tablet and mobile layouts reflow without fixed minimum grid widths. The page includes a skip link, labelled forms, keyboard focus, mobile navigation, native modal dialogs and reduced-motion support. Four statistics and horizontal coverage remain on desktop.

The hero and service slides use independent full-resolution images. The phone illustration is native HTML/CSS with the supplied company logo and working booking, update and quotation buttons. The coverage illustration is an independent SVG. Service slides use `object-fit: cover` and individual focal points. Mobile captions use smaller typography and omit decorative badges. Active and following slide images load eagerly. Hidden, inert boundary copies allow the slideshow to wrap smoothly in either direction; their IDs are removed to avoid duplicate references. The copies do not appear in the accessible slide count.

## Validation

Checked in headless Chrome at 320, 390, 600, 768, 900, 1024 and 1440 pixels: no horizontal page overflow, broken image references, duplicate IDs or broken internal anchors. Booking, quotation and update forms produce correctly encoded WhatsApp requests; required-field and phone validation, modal focus, Escape dismissal and scroll restoration were checked. The JavaScript syntax check passes. External messages were not sent.

The slideshow was checked at 320, 390, 768, 1024 and 1440 pixels: its slide width matches the full page width, with one accessible slide at a time. Automatic advance, previous/next, slide selectors, keyboard navigation, touch swipe, service-link selection and reduced-motion defaults passed browser checks. Header and footer use `Company Logo.jpeg`.

The replacement service images were individually decoded and inspected in desktop and mobile slide views. All five are 1672 × 941 pixels with descriptive alternative text. Captions clear the navigation controls, and no horizontal page overflow was found. Mobile focal points prioritise the document handover, parcel scanning, food containers, pallet loading and tablet consultation.

Business-readiness checks passed for the new booking fields, encoded WhatsApp messages, date/working-day validation, visible operating hours, Delivery Updates wording, all image resources, two-second automatic advance, forward/backward boundary wrapping, and hidden/inert boundary copies. No horizontal overflow was found at 320, 390, 768, 1024 and 1440 pixels. Messages were prepared in a browser test without sending any WhatsApp requests.
