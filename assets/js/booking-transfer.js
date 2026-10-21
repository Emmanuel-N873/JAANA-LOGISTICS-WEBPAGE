(() => {
 'use strict';
 const key='jaana.shipmentDraft.v1', dialog=document.getElementById('booking-dialog'), form=dialog.querySelector('form');
 const fields=['pickup','destination','packages','weight','size'];
 const bookingDraftKey='jaana.bookingDetailsDraft.v1';
 // Explicit allowlist: never persist credentials, payment fields or arbitrary form inputs.
 const bookingDetailFields=['service','date','recipient','recipientPhone','name','phone','package'];
 function restoreBookingDetails(){
  try{
   const saved=JSON.parse(sessionStorage.getItem(bookingDraftKey)||'null');
   for(const name of bookingDetailFields){
    if(typeof saved?.[name]==='string'&&saved[name].length<=500)form.elements[name].value=saved[name];
   }
  }catch{ /* The current form remains usable if storage is unavailable. */ }
 }
 function clearBookingDrafts(){
  for(const storageKey of [key,bookingDraftKey]){
   try{sessionStorage.removeItem(storageKey);}catch{ /* Clearing storage is best effort. */ }
  }
 }
 window.addEventListener('jaana-booking-saved',clearBookingDrafts);
 const transferredFields=[...fields,'distanceKm','estimateSummary'];
 let locationTokens = {
  pickupToken: null,
  destinationToken: null
 };

 window.jaanaBookingLocationTokens = () => ({ ...locationTokens });
 let locked=false, originalSize=null;
 function readDraft(){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
 function setLocked(value){
  locked=value;
  // A readonly input keeps package size in FormData; disabled selects are omitted.
  if(value&&form.elements.size.tagName==='SELECT'){
   originalSize=form.elements.size;
   const display=document.createElement('input');
   display.name='size';display.type='text';display.value=originalSize.value;
   display.required=true;originalSize.replaceWith(display);
  }else if(!value&&originalSize){
   form.elements.size.replaceWith(originalSize);originalSize=null;
  }
  for(const name of transferredFields){
   const field=form.elements[name];
   field.readOnly=value||['distanceKm','estimateSummary'].includes(name);
   field.toggleAttribute('data-calculator-locked',value);
   if(value)field.setAttribute('aria-describedby','booking-shipment-help');
   else field.removeAttribute('aria-describedby');
  }
 }
 function openBooking(){
  if(location.hash!=='#booking')return;
  restoreBookingDetails();
  const draft=readDraft();
  if(draft?.fields){
   locationTokens = {
    pickupToken: typeof draft.fields.pickupToken === 'string'
     ? draft.fields.pickupToken
     : null,
    destinationToken: typeof draft.fields.destinationToken === 'string'
     ? draft.fields.destinationToken
     : null
   };
   for(const name of fields){const value=draft.fields[name];if(typeof value==='string'&&value.length<=500)form.elements[name].value=value;}
   if(Number.isFinite(draft.distanceKm)&&draft.distanceKm>0)form.elements.distanceKm.value=draft.distanceKm;
   if(typeof draft.estimateSummary==='string')form.elements.estimateSummary.value=draft.estimateSummary.slice(0,1000);
   setLocked(true);
  }
  if(!dialog.open)dialog.showModal();document.body.classList.add('dialog-open');
 }
 function saveForCalculator(){
  try{
   sessionStorage.setItem(bookingDraftKey,JSON.stringify(Object.fromEntries(bookingDetailFields.map(name=>[name,form.elements[name].value]))));
   sessionStorage.setItem(key,JSON.stringify({fields:Object.fromEntries(fields.map(name=>[name,form.elements[name].value]))}));
   return true;
  }catch{
   document.getElementById('booking-feedback').textContent='Enable session storage to carry your shipment details to the calculator.';
   return false;
  }
 }
 function offerAdjustment(){
  if(window.confirm('These shipment details came from the delivery calculator and cannot be edited here. Would you like to return to the delivery calculator to make adjustments?')&&saveForCalculator())window.location.href='calculator.html';
 }
 form.addEventListener('click',event=>{if(locked&&event.target.matches('[data-calculator-locked]'))offerAdjustment();});
 form.addEventListener('keydown',event=>{
  if(!locked||!event.target.matches('[data-calculator-locked]')||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==='Enter'||event.key==='Backspace'||event.key==='Delete'||event.key.length===1){event.preventDefault();offerAdjustment();}
 });
 openBooking();window.addEventListener('hashchange',openBooking);
 form.addEventListener('input',event=>{
  if(!locked&&fields.includes(event.target.name)){
   locationTokens = {
    pickupToken: null,
    destinationToken: null
   };

   form.elements.distanceKm.value='';form.elements.estimateSummary.value='Shipment changed. Recalculate for an updated estimate.';
  }
 });
 document.getElementById('booking-recalculate').addEventListener('click',event=>{if(!saveForCalculator())event.preventDefault();});
 dialog.addEventListener('close',()=>{if(location.hash==='#booking')history.replaceState(null,'',location.pathname+location.search);});
 document.getElementById('new-booking-request').addEventListener('click',()=>{setLocked(false);
  locationTokens = {
   pickupToken: null,
   destinationToken: null
  };
clearBookingDrafts();});
})();
