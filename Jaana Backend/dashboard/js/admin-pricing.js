(() => {
 const button=document.getElementById('manage-pricing'), dialog=document.getElementById('pricing-dialog'), form=document.getElementById('pricing-form'), message=document.getElementById('pricing-message');
 let session=0;
 window.addEventListener('staff-session',event=>{session++;button.hidden=!(event.detail?.role==='admin'&&!event.detail.mustChangePassword&&!event.detail.mustEnrollMfa);if(button.hidden)dialog.close();});
 async function api(options={}){const r=await fetch('/api/pricing',{...options,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Pricing request failed.');return d;}
 button.addEventListener('click',async()=>{dialog.showModal();message.textContent='Loading current rates…';form.hidden=true;const current=session;try{const d=await api();if(current!==session)return;form.elements.perKm.value=d.perKm;form.elements.minimum.value=d.minimum;form.hidden=false;message.textContent='';}catch(e){message.textContent=e.message;}});
 document.getElementById('close-pricing').addEventListener('click',()=>dialog.close());
 form.addEventListener('submit',async event=>{event.preventDefault();const submit=form.querySelector('button');submit.disabled=true;message.textContent='Saving…';const current=session;try{await api({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({perKm:Number(form.elements.perKm.value),minimum:Number(form.elements.minimum.value)})});if(current===session)message.textContent='Pricing saved. New estimates will use these rates.';}catch(e){if(current===session)message.textContent=e.message;}finally{submit.disabled=false;}});
})();
