(() => {
 'use strict';
 const $=id=>document.getElementById(id), form=$('rate-form');
 const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(n);
 let quote=null, version=0, timer;
 const selectedLocations = {
  pickup: null,
  destination: null
 };
 function setupAddressAutocomplete(name) {
  const input = form.elements[name];
  const list = $(name === 'pickup'
    ? 'pickup-suggestions'
    : 'destination-suggestions');

  let searchTimer;
  let controller;
  let activeIndex = -1;
  let suggestions = [];
  let generation = 0;
  let blurTimer;

  function close() {
    list.hidden = true;
    list.replaceChildren();
    suggestions = [];
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function selectSuggestion(index) {
    const suggestion = suggestions[index];

    if (!suggestion || typeof suggestion.token !== 'string') {
      return;
    }

    clearTimeout(searchTimer);
    clearTimeout(blurTimer);
    generation++;
    controller?.abort();

    // Display the selected address.
    input.value = suggestion.label;

    // Save its authenticated location reference.
    selectedLocations[name] = {
      label: suggestion.label,
      token: suggestion.token
    };

    close();

    // Clear any previous estimate without triggering
    // another autocomplete search.
    invalidate();
    $('rate-feedback').textContent =
      'Address selected. Select the other address, then calculate your estimate.';
  }

  function highlight(index) {
    const buttons = [...list.querySelectorAll('button')];
    if (!buttons.length) return;

    activeIndex = (index + buttons.length) % buttons.length;

    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === activeIndex));
    });

    const active = buttons[activeIndex];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    selectedLocations[name] = null;
    generation++;
    clearTimeout(blurTimer);

    clearTimeout(searchTimer);
    controller?.abort();
    close();

    const query = input.value.trim();
    if (query.length < 3) return;
    if(query.length>150){$('rate-feedback').textContent='Use an address search of at most 150 characters.';return;}
    const searchVersion=generation;

    searchTimer = setTimeout(async () => {
      controller = new AbortController();
      const requestController = controller;

      try {
        const response = await fetch(
          '/api/locations?q=' + encodeURIComponent(query),
          { signal: requestController.signal }
        );

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Address suggestions are unavailable. Please retry.');

        // Ignore responses for an address that has since changed.
        if (searchVersion!==generation || document.activeElement!==input || requestController.signal.aborted ||
            input.value.trim() !== query) return;

        suggestions = Array.isArray(data.suggestions)
          ? data.suggestions.slice(0, 5)
          : [];

        list.replaceChildren();

        suggestions.forEach((suggestion, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.id = `${name}-suggestion-${index}`;
          button.className = 'address-suggestion';
          button.setAttribute('role', 'option');
          button.setAttribute('aria-selected', 'false');
          button.textContent = suggestion.label;

          button.addEventListener('pointerdown', event => {
            event.preventDefault();
          });

          button.addEventListener('click', () => {
            selectSuggestion(index);
          });

          list.appendChild(button);
        });

        list.hidden = suggestions.length === 0;
        if(!suggestions.length)$('rate-feedback').textContent='No matching addresses found. Try a street, landmark, area and city.';
        input.setAttribute(
          'aria-expanded',
          String(suggestions.length > 0)
        );
      } catch (error) {
        if(error.name!=='AbortError'&&searchVersion===generation&&document.activeElement===input){close();$('rate-feedback').textContent=error.message||'Address suggestions are unavailable. Please retry.';}
      }
    }, 400);
  });

  input.addEventListener('keydown', event => {
    if (list.hidden || !suggestions.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(activeIndex);
    } else if (event.key === 'Escape') {
      clearTimeout(searchTimer);controller?.abort();generation++;close();
    }
  });

  input.addEventListener('blur', () => {
    clearTimeout(searchTimer);controller?.abort();generation++;
    blurTimer=setTimeout(close,150);
  });

  form.addEventListener('reset', () => {
    selectedLocations[name]=null;generation++;clearTimeout(blurTimer);
    clearTimeout(searchTimer);
    controller?.abort();
    close();
  });
 }
 function updateCustomQuotation(){
  const weight=form.elements.weight.valueAsNumber;
  $('custom-quotation').hidden=!(Number.isFinite(weight)&&weight>20);
 }
 const payload = () => ({
  ...Object.fromEntries(new FormData(form)),
  pickupToken: selectedLocations.pickup?.token ?? null,
  destinationToken: selectedLocations.destination?.token ?? null
});
 const summary=q=>`Road distance: ${q.distanceKm.toFixed(3)} km\nDistance: ${money(q.distanceCharge)}${q.minimumApplied?' (minimum '+money(q.rates.minimum)+' applied)':''}\nWeight charge: ${q.weightCharge===null?'Custom quotation':money(q.weightCharge)}\nEstimated total: ${q.total===null?'Custom quotation required':money(q.total)}`;
 function rates(r){document.querySelectorAll('[data-per-km]').forEach(e=>e.textContent=money(r.perKm));document.querySelectorAll('[data-minimum]').forEach(e=>e.textContent=money(r.minimum));$('rate-formula').textContent=`Total = higher of ${money(r.minimum)} or (road distance × ${money(r.perKm)}), plus weight charge.`;}
 rates({perKm:300,minimum:2000});
 fetch('/api/pricing',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();rates(await r.json());}).catch(()=>{$('rate-feedback').textContent='Displayed rates are defaults. Current pricing will be checked when you calculate.';});
 function invalidate(){$('rate-contact').href='https://wa.me/2348038422591';version++;quote=null;$('continue-booking').disabled=true;for(const id of ['road-distance','distance-charge','weight-charge','rate-total'])$(id).textContent='—';$('minimum-row').hidden=true;$('route-map').hidden=true;}
 async function calculate(){
  if(!form.reportValidity())return;
  if(!selectedLocations.pickup?.token||!selectedLocations.destination?.token){$('rate-feedback').textContent='Please select both addresses from the suggestions before calculating.';return;}
  const current=++version;quote=null;$('continue-booking').disabled=true;
  $('rate-feedback').textContent='Finding your road route and current pricing…';
  try{
   const response=await fetch('/api/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload()),signal:AbortSignal.timeout(15000)});
   const q=await response.json();if(current!==version)return;if(!response.ok)throw Error(q.error||'Could not calculate this route.');
   quote=q;rates(q.rates);$('road-distance').textContent=q.distanceKm.toFixed(3)+' km';$('distance-charge').textContent=money(q.distanceCharge);$('distance-label').textContent=`Distance charge × ${money(q.rates.perKm)}/km`;
   $('weight-charge').textContent=q.weightCharge===null?'Custom quote':money(q.weightCharge);$('minimum-row').hidden=!q.minimumApplied;$('rate-total').textContent=q.total===null?'Custom quote':money(q.total);
   const data=payload();$('route-map').href='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(data.pickup)+'&destination='+encodeURIComponent(data.destination)+'&travelmode=driving';$('route-map').hidden=false;
   $('rate-contact').href='https://wa.me/2348038422591?text='+encodeURIComponent('Hello JAANA Logistics, please quote for my shipment.\n'+Object.entries(data)
  .filter(([key]) => !['pickupToken', 'destinationToken'].includes(key))
  .map(([key, value]) => `${key}: ${value}`)
  .join('\n')+'\n'+summary(q));
   $('continue-booking').disabled=false;$('rate-feedback').textContent=q.total===null?'Your shipment needs a custom quotation. Continue to record your details or contact us on WhatsApp.':'Route calculated. Check the route on Google Maps, then continue to booking.';
  }catch(e){if(current===version)$('rate-feedback').textContent=e.name==='TimeoutError'?'Map request timed out. Please retry.':e.message;}
 }
 form.addEventListener('submit',e=>{e.preventDefault();clearTimeout(timer);calculate();});
 form.addEventListener('input', () => {
  updateCustomQuotation();
  invalidate();
  clearTimeout(timer);

  $('rate-feedback').textContent =
    'Select your pickup and delivery addresses, then click Calculate Estimate.';
});
 form.addEventListener('reset',()=>{$('custom-quotation').hidden=true;clearTimeout(timer);invalidate();$('rate-feedback').textContent='';$('rate-contact').href='https://wa.me/2348038422591';});
 $('continue-booking').addEventListener('click',()=>{
  if(!quote)return;
  try{sessionStorage.setItem('jaana.shipmentDraft.v1',JSON.stringify({fields:payload(),distanceKm:quote.distanceKm,estimateSummary:summary(quote)}));window.location.href='index.html#booking';}
  catch{$('rate-feedback').textContent='Please enable session storage in your browser to carry shipment details to booking.';}
 });
 try{const draft=JSON.parse(sessionStorage.getItem('jaana.shipmentDraft.v1')||'null');if(draft?.fields)for(const [name,value] of Object.entries(draft.fields))if(form.elements[name])form.elements[name].value=value;}catch{}
 $('rate-contact').addEventListener('click',()=>{
  const data=payload();
  const lines=Object.entries(data).filter(([name])=>!['pickupToken','destinationToken'].includes(name)).map(([name,value])=>name+': '+value);
  $('rate-contact').href='https://wa.me/2348038422591?text='+encodeURIComponent('Hello JAANA Logistics, please quote for my shipment.\n'+lines.join('\n')+(quote?'\n'+summary(quote):''));
 });
 setupAddressAutocomplete('pickup');
 setupAddressAutocomplete('destination');
 updateCustomQuotation();
})();
