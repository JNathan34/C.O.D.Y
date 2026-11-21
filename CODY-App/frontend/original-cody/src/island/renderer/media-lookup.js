'use strict';
(()=>{
 const api=window.assistant?.selfHosted;
 if(!api)return;
 const cards=new Map();
 const labels={available:'Available on Plex',partial:'Partly available',processing:'Request processing',
  requested:'Already requested',missing:'Missing from Plex',unknown:'Availability unclear'};
 const element=(tag,cls,text)=>{
  const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;
 };
 const canRequest=item=>!item.blocked&&['missing','partial'].includes(item.availability);
 function poster(item){
  const cover=element('div','media-result-poster');
  const fallback=element('span');fallback.setAttribute('aria-hidden','true');window.CODYIcons?.set(fallback,'film');cover.append(fallback);
  if(typeof item.posterPath==='string'&&/^\/[\w-]{1,120}\.(?:jpg|jpeg|png|webp)$/i.test(item.posterPath)){
   const img=element('img');img.alt=item.title+' poster';img.referrerPolicy='no-referrer';
   img.addEventListener('error',()=>img.remove(),{once:true});
   img.src='https://image.tmdb.org/t/p/w342'+item.posterPath;cover.append(img);
  }
  return cover;
 }
 function action(label,handler,busy,style='light-action'){
  const button=element('button',style,label);button.type='button';button.disabled=Boolean(busy);
  button.addEventListener('click',handler);return button;
 }
 function seasonPicker(card,copy){
  const seasons=element('fieldset','media-seasons');seasons.append(element('legend','','Seasons to request'));
  const checked=()=>[...seasons.querySelectorAll('input:checked')].map(input=>Number(input.value));
  const submit=action('Request selected seasons',()=>void request(card,checked()),true);
  for(const season of card.preview.seasons.filter(season=>!season.blocked)){
   const label=element('label'),input=element('input');input.type='checkbox';input.value=season.number;input.disabled=card.busy;
   input.addEventListener('change',()=>{submit.disabled=!checked().length;});
   label.append(input,document.createTextNode(season.name));seasons.append(label);
  }
  copy.append(seasons,submit);
 }
 function showFeedback(card){
  card.view.querySelector('.media-result-feedback')?.remove();
  const text=card.busy?'Checking Overseerr…':card.opening||card.linkError||card.feedback;
  if(!text)return;
  const notice=element('p','media-result-feedback',text);
  notice.setAttribute('role','status');card.view.append(notice);
 }
 function paint(card){
  const root=card.view;root.replaceChildren();
  for(const item of card.result?[card.result]:card.choices){
   const row=element('article','media-result'),copy=element('div','media-result-copy');
   const actions=element('div','media-result-actions');
   const requesting=card.result&&!card.sent&&!card.failed&&canRequest(item);
   copy.append(element('h3','',item.title),element('p','media-result-meta',
    [item.type==='movie'?'Movie':'TV series',/^\d{4}$/.test(item.year)?item.year:''].filter(Boolean).join(' · ')));
   if(!card.result)actions.append(action('Check availability',()=>void select(card,item),card.busy));
   else{
    const status=element('p','media-result-status',card.sent||labels[item.availability]);
    status.dataset.availability=card.sent?'requested':item.availability;copy.append(status);
    if(['available','partial'].includes(item.availability))
     actions.append(action('Watch on Plex',event=>void openMedia(card,item,'plex',event.currentTarget),card.busy));
    if(requesting){
     if(item.type==='movie')actions.append(action('Request movie',()=>void request(card),card.busy));
     else if(!card.preview)actions.append(action('Choose seasons',()=>void select(card,item),card.busy));
    }
   }
   actions.append(action('View on Overseerr',event=>void openMedia(card,item,'overseerr',event.currentTarget),card.busy,'secondary-action'));
   copy.append(actions);
   if(requesting&&item.type==='tv'&&card.preview)seasonPicker(card,copy);
   row.append(poster(item),copy);root.append(row);
  }
  showFeedback(card);
 }
 async function openMedia(card,item,site,button){
  if(card.busy||card.opening)return;
  card.opening=site==='plex'?'Opening Plex…':'Opening Overseerr…';card.linkError='';button.disabled=true;showFeedback(card);
  try{await api.openMedia({site,type:item.type,id:item.id});}
  catch(error){card.linkError=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
  finally{card.opening='';button.disabled=false;showFeedback(card);}
 }
 async function select(card,item){
  if(card.busy||card.opening)return;card.busy=true;card.feedback='';card.linkError='';paint(card);
  try{
   const match=await api.requestPreview({type:item.type,id:item.id});
   card.preview=match;card.result={...item,...match,posterPath:match.posterPath||item.posterPath};
   if(canRequest(match))card.feedback='Want me to request it?';
  }catch(error){card.feedback=error.message;}
  finally{card.busy=false;paint(card);}
 }
 async function request(card,seasons){
  if(card.busy||card.opening||card.sent||card.failed)return;
  card.busy=true;card.feedback='';card.linkError='';paint(card);
  try{
   const item=card.result,preview=card.preview||await api.requestPreview({type:item.type,id:item.id});
   if(!canRequest(preview)){
    card.result={...item,...preview,posterPath:preview.posterPath||item.posterPath};return;
   }
   const receipt=await api.requestSubmit({token:preview.token,...(seasons?{seasons}:{})});
   card.sent=receipt.status===1?'Requested · pending approval':'Requested on Overseerr';
  }catch(error){card.failed=true;card.feedback=error.message;}
  finally{card.busy=false;paint(card);}
 }
 window.CODYMediaLookup={decorate(node,message){
  const media=message?.role==='assistant'&&message.mediaLookup;if(!media)return;
  let card=cards.get(message.id);
  if(!card){
   if(cards.size>=40)cards.delete(cards.keys().next().value);
   card={choices:media.choices||[],result:media.result};cards.set(message.id,card);
  }
  node.querySelector('.media-lookup')?.remove();
  card.view=element('div','media-lookup');node.append(card.view);paint(card);
 }};
})();
