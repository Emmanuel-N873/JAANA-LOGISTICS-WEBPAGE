(() => {
 'use strict';
 const $=id=>document.getElementById(id),form=$('mfa-form'),dialog=$('mfa-dialog');let user=null,action='begin',generation=0,showingCodes=false;
 function reset(){form.reset();$('mfa-secret').value='';$('mfa-recovery-codes').value='';$('mfa-recovery').hidden=true;$('mfa-setup').hidden=true;$('mfa-message').textContent='';form.hidden=false;showingCodes=false;}
 function open(){reset();action=user?.mfaEnabled?'disable':'begin';$('mfa-submit').textContent=action==='disable'?'Disable authenticator':'Set up authenticator';$('mfa-code-label').hidden=action==='begin';form.elements.code.required=action==='disable';$('mfa-account').textContent=user?.email||'';if(!dialog.open)dialog.showModal();}
 window.addEventListener('staff-session',event=>{generation++;user=event.detail;$('mfa-settings').hidden=!user||user.mustChangePassword;if(dialog.open)dialog.close();reset();if(user?.mustEnrollMfa&&!user.mustChangePassword)open();});
 $('mfa-settings').addEventListener('click',open);
 function close(){if(showingCodes){if(!confirm('Have you saved your recovery codes? They will no longer be displayed.'))return;window.JaanaStaff.logout();}dialog.close();reset();}
 $('mfa-close').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 $('mfa-finish').addEventListener('click',()=>{showingCodes=false;window.JaanaStaff.logout();dialog.close();reset();$('staff-message').textContent='Authenticator enabled. Sign in using your password and a fresh authenticator code.';});
 form.addEventListener('submit',async event=>{
  event.preventDefault();const version=generation,button=$('mfa-submit');if(button.disabled)return;button.disabled=true;
  const payload={action,password:form.elements.password.value,code:form.elements.code.value.trim()};
  try{
   const result=await window.JaanaStaff.api('/api/mfa',{method:'POST',body:JSON.stringify(payload)});if(version!==generation)return;
   if(action==='begin'){
    $('mfa-secret').value=result.secret;$('mfa-setup').hidden=false;$('mfa-code-label').hidden=false;form.elements.code.required=true;action='confirm';button.textContent='Verify code and enable';$('mfa-message').textContent='Enter the six-digit code from your authenticator to finish setup.';
   }else if(action==='confirm'){
    // Stop background polling before displaying one-time codes from a revoked session.
    window.JaanaStaff.logout();if(!dialog.open)dialog.showModal();
    form.reset();form.hidden=true;$('mfa-secret').value='';$('mfa-recovery-codes').value=result.recoveryCodes.join('\n');$('mfa-recovery').hidden=false;showingCodes=true;$('mfa-message').textContent='Authenticator enabled. All previous sessions have been revoked.';
   }else{window.JaanaStaff.logout();dialog.close();reset();$('staff-message').textContent='Authenticator disabled. Sign in again.';}
  }catch(error){if(version===generation)$('mfa-message').textContent=error.message;}finally{button.disabled=false;payload.password='';}
 });
})();
