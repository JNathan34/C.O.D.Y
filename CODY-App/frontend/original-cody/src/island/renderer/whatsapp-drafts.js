'use strict';
(()=>{
  const api=window.assistant?.whatsapp;
  if(!api)return;
  const element=(tag,text,className)=>{
    const node=document.createElement(tag);
    if(text)node.textContent=text;
    if(className)node.className=className;
    return node;
  };
  const button=(title,callback)=>{
    const node=element('button',title,'light-action');node.type='button';node.addEventListener('click',callback);return node;
  };
  const errorText=error=>error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');
  const panel=document.querySelector('[data-plugin-panel="whatsapp-drafts"]');
  const link=document.getElementById('whatsapp-link'),check=document.getElementById('whatsapp-check');
  const enabled=document.getElementById('whatsapp-enabled'),feedback=document.getElementById('whatsapp-status');
  let busy=false,state=null;
  function render(){
    link.disabled=check.disabled=busy;
    enabled.checked=state?.enabled===true;
    enabled.disabled=busy||(!state?.enabled&&!state?.ready);
  }
  async function setup(action){
    if(busy)return;
    busy=true;render();
    try{
      state=await action();
      feedback.textContent=state.ready?'WhatsApp Web is linked.':state.busy?'A WhatsApp message is in progress.':
        state.unavailable?'WhatsApp Web could not be reached.':'Open the link window to sign in. Check the connection after signing in.';
    }catch(error){feedback.textContent=errorText(error);}
    finally{busy=false;render();}
  }
  panel?.addEventListener('toggle',()=>{if(panel.open)void setup(()=>api.state());});
  link?.addEventListener('click',()=>void setup(api.link));
  check?.addEventListener('click',()=>void setup(()=>api.state(true)));
  enabled?.addEventListener('change',()=>{const value=enabled.checked;void setup(()=>api.enable(value));});
  window.addEventListener('focus',()=>{if(panel?.open&&panel.getClientRects().length)void setup(()=>api.state());});
  window.CODYWhatsAppDrafts={async decorate(node,message){
    const id=message?.whatsappDraftId;
    if(!id||node.querySelector('.whatsapp-draft'))return;
    const card=element('section',null,'whatsapp-draft');card.setAttribute('aria-label','WhatsApp draft');node.append(card);
    const status=element('p');status.setAttribute('role','status');
    const opened=()=>card.replaceChildren(element('p','Continue in WhatsApp to send your message.'));
    try{
      const draft=await api.preview(id);
      if(draft?.opened){opened();return;}
      if(!draft){card.append(element('p','Draft expired. Ask Cody to prepare it again.'));return;}
      const open=button(draft.phone?'Open in WhatsApp':'Choose contact in WhatsApp',async()=>{
        open.disabled=true;status.textContent='Opening WhatsApp…';
        try{await api.open(id);opened();}
        catch(error){status.textContent=errorText(error);open.disabled=false;}
      });
      const recipient=draft.phone?`To ${draft.phone}`:`Choose ${draft.recipient} in WhatsApp`;
      card.append(element('p',recipient,'whatsapp-draft-recipient'),
        element('p',draft.text,'whatsapp-draft-body'),open,status);
    }catch(error){status.textContent=errorText(error);card.append(status);}
  }};
})();
