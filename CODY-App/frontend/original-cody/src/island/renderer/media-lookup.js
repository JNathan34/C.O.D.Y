'use strict';
(()=>{
 const api=window.assistant?.selfHosted;
 if(!api)return;
 const cards=new Map();
 const preview=document.getElementById('island-media-preview');
 const previewContent=document.getElementById('island-media-preview-content');
 const previewChat=document.getElementById('island-media-open-chat');
 const previewBrand=document.getElementById('island-preview-brand');
 const rgbControls=document.getElementById('island-rgb-controls');
 const rgbClose=document.getElementById('island-rgb-close');
 let previewId=null,previewSource=null,dismissedId=null,openPreviewChat;
 const labels={available:'Available on Plex',partial:'Partly available',processing:'Request processing',
  requested:'Already requested',missing:'Missing from Plex',unknown:'Availability unclear'};
 const element=(tag,cls,text)=>{
  const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;
 };
 const canRequest=item=>!item.blocked&&['missing','partial'].includes(item.availability);
 const plexPosterSource=value=>typeof value==='string'&&value.length<87500&&/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)?value:'';
 const playbackStates={paused:'Paused',playing:'Playing',buffering:'Buffering',stopped:'Stopped'};
 const playbackIcons={paused:'pause',playing:'play',buffering:'activity',stopped:'square'};
 const playbackState=value=>Object.hasOwn(playbackStates,value)?playbackStates[value]:'State unknown';
 function icon(name,cls){
  const node=element('span',cls);
  node.setAttribute('aria-hidden','true');window.CODYIcons?.set(node,name);
  return node;
 }
 function mediaImage(source,cls,alt=''){
  const img=element('img',cls);
  img.alt=alt;img.referrerPolicy='no-referrer';
  img.addEventListener('error',()=>img.remove(),{once:true});
  img.src=source;
  return img;
 }
 function poster(item){
  const cover=element('div','media-result-poster');
  cover.append(icon('film'));
  const source=plexPosterSource(item.poster)||
   (typeof item.posterPath==='string'&&/^\/[\w-]{1,120}\.(?:jpg|jpeg|png|webp)$/i.test(item.posterPath)?'https://image.tmdb.org/t/p/w342'+item.posterPath:'');
  if(source)cover.append(mediaImage(source,'',item.title+' poster'));
  return cover;
 }
 function playerBadge(session){
  const {type,label,glyph,caption}=window.CODYPlexPlayers.identify(session);
  const badge=element('span','plex-player-badge');
  const symbol=icon(glyph,'plex-player-symbol');
  const name=session.player&&session.player!=='Unknown'?session.player:'';
  badge.dataset.playerType=type;
  badge.setAttribute('role','img');
  badge.setAttribute('aria-label',name&&name!==label?label+' · '+name:label);
  badge.append(symbol);
  if(caption)badge.append(element('span','plex-player-label',caption));
  const logo=window.CODYIcons?.browserLogo(type);
  if(logo){
   const image=mediaImage(logo);
   image.addEventListener('load',()=>symbol.replaceChildren(image),{once:true});
  }
  return badge;
 }
 function playbackTime(milliseconds){
  const seconds=Math.floor(milliseconds/1000);
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60;
  return (hours?hours+':'+String(minutes).padStart(2,'0'):minutes)+':'+String(seconds%60).padStart(2,'0');
 }
 function playbackRow(session){
  const row=element('div','plex-playback');
  const state=playbackState(session.state);
  const glyph=Object.hasOwn(playbackIcons,session.state)?playbackIcons[session.state]:'circle-help';
  row.append(icon(glyph,'plex-playback-state'));
  const {durationMs,positionMs}=session;
  if(!Number.isSafeInteger(durationMs)||durationMs<=0||!Number.isSafeInteger(positionMs)||positionMs<0){
   const player=session.player&&session.player!=='Unknown'?session.player:'';
   row.append(element('span','plex-playback-label',[state,player].filter(Boolean).join(' · ')));
   return row;
  }
  const position=Math.min(positionMs,durationMs);
  const elapsed=playbackTime(position),total=playbackTime(durationMs);
  const progress=element('progress','plex-playback-progress');
  progress.max=durationMs;progress.value=position;
  progress.setAttribute('aria-label',state+' · Playback position');
  progress.setAttribute('aria-valuetext',elapsed+' of '+total);
  row.append(progress,element('span','plex-playback-time',elapsed+' / '+total));
  return row;
 }
 function paintSessions(root,{sessions,count}){
  root.classList.add('plex-session-list');
  for(const session of sessions){
   const title=session.showTitle||session.title;
   const row=element('article','media-result plex-session'),copy=element('div','media-result-copy');
   const backdrop=plexPosterSource(session.backdrop)||plexPosterSource(session.poster);
   if(backdrop)row.append(mediaImage(backdrop,'plex-session-backdrop'));
   const heading=element('div','plex-session-heading');
   heading.append(element('h3','',title),playerBadge(session));
   copy.append(heading);
   if(session.showTitle&&session.showTitle!==session.title)copy.append(element('p','media-result-meta',session.title));
   const viewer=element('div','plex-session-viewer');
   const avatar=element('span','plex-viewer-avatar',Array.from(session.viewer?.trim()||'?')[0].toUpperCase());
   avatar.setAttribute('aria-hidden','true');
   if(session.avatarUrl)avatar.append(mediaImage(session.avatarUrl));
   viewer.append(avatar,element('span','plex-viewer-name',session.viewer));
   copy.append(viewer,playbackRow(session));
   row.append(poster({...session,title}),copy);root.append(row);
  }
  if(count>sessions.length)root.append(element('p','media-result-meta',`And ${count-sessions.length} more.`));
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
 function showFeedback(card,root){
  root.querySelector('.media-result-feedback')?.remove();
  const text=card.busy?'Checking Overseerr…':card.opening||card.linkError||card.feedback;
  if(!text)return;
  const notice=element('p','media-result-feedback',text);
  notice.setAttribute('role','status');root.append(notice);
 }
 function updateViews(card,render){
  for(const root of card.views){
   if(root.isConnected)render(card,root);
   else card.views.delete(root);
  }
 }
 function paintView(card,root){
  root.replaceChildren();
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
  showFeedback(card,root);
 }
 const paint=card=>updateViews(card,paintView);
 async function openMedia(card,item,site,button){
  if(card.busy||card.opening)return;
  card.opening=site==='plex'?'Opening Plex…':'Opening Overseerr…';card.linkError='';button.disabled=true;updateViews(card,showFeedback);
  try{await api.openMedia({site,type:item.type,id:item.id});}
  catch(error){card.linkError=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
  finally{card.opening='';button.disabled=false;updateViews(card,showFeedback);}
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
 function decorate(node,message){
  const media=message?.role==='assistant'&&message.mediaLookup;if(!media)return;
  node.querySelector('.media-lookup')?.remove();
  const root=element('div','media-lookup');node.append(root);
  if(Array.isArray(media.sessions)){paintSessions(root,media);return;}
  let card=cards.get(message.id);
  if(!card){
   if(cards.size>=40)cards.delete(cards.keys().next().value);
   card={choices:media.choices||[],result:media.result,views:new Set()};cards.set(message.id,card);
  }
  for(const view of card.views)if(!view.isConnected)card.views.delete(view);
  card.views.add(root);paintView(card,root);
 }
 function paintPreviewBrand(source){
  previewBrand.replaceChildren();
  if(source==='rgb'){
   const icon=element('span');icon.setAttribute('aria-hidden','true');
   window.CODYIcons?.set(icon,'palette');previewBrand.append(icon,element('span','','RGB Control'));
   return;
  }
  const plex=source==='plex';
  const logo=element('img',plex?'plex-wordmark':'');
  logo.src=plex?'assets/media/plex-wordmark.svg':'assets/media/overseerr.svg';
  logo.alt=plex?'Plex':'';
  previewBrand.append(logo);
  if(!plex)previewBrand.append(element('span','','Overseerr'));
 }
 function present(candidate,openChat){
  if(!preview)return;
  const id=candidate?.messageId!==dismissedId?candidate?.messageId:null;
  if((id??null)===previewId)return;
  const active=Boolean(id),expanded=document.body.classList.contains('panel-open');
  const plex=active&&candidate.source==='plex';
  const rgb=active&&candidate.source==='rgb';
  previewId=id??null;
  previewSource=active?candidate.source:null;
  openPreviewChat=active&&!rgb?openChat:null;
  preview.inert=!active;
  document.body.classList.toggle('media-preview-layout',active);
  document.body.classList.toggle('plex-preview-layout',plex);
  document.body.classList.toggle('rgb-preview-layout',rgb);
  const island=document.getElementById('island');
  if(active){
   island.removeAttribute('role');
   island.removeAttribute('aria-label');
   island.removeAttribute('aria-expanded');
   island.tabIndex=-1;
   paintPreviewBrand(candidate.source);
   preview.setAttribute('aria-label',rgb?'RGB controls':plex?'Plex viewing activity':'Overseerr result');
   rgbClose.hidden=!rgb;rgbControls.hidden=!rgb;previewChat.hidden=rgb;previewContent.hidden=rgb;
   if(rgb)window.CODYRgbLighting?.show();
   else{
    previewChat.setAttribute('aria-label',plex?'Open Plex viewing activity in chat':'Open Overseerr result in chat');
    previewContent.scrollTop=0;
    decorate(previewContent,{role:'assistant',id,mediaLookup:candidate.mediaLookup});
   }
  }else{
   island.setAttribute('role','button');
   island.setAttribute('aria-label','Open C.O.D.Y. quick panel');
   island.setAttribute('aria-expanded',String(expanded));
   island.tabIndex=expanded?-1:0;
  }
  window.cody?.setMediaPreview?.(active?(rgb?'rgb':plex?'plex':'media'):null);
 }
 function dismissPreview(){
  if(!previewId)return;
  dismissedId=previewId;
  if(previewSource==='rgb')void window.assistant.rgb.dismiss(previewId).catch(()=>{});
  present(null);
 }
 function activatePreviewAt(x,y){
  if(!previewId)return;
  const target=document.elementFromPoint(x,y);
  if(previewSource==='rgb'&&target?.closest('#island-rgb-wheel'))window.CODYRgbLighting?.pickAt(x,y);
  else target?.closest('#island-media-preview button,#island-media-preview label,#island-media-preview summary')?.click();
 }
 rgbClose?.addEventListener('click',dismissPreview);
 previewChat?.addEventListener('click',()=>{
  dismissedId=previewId;
  openPreviewChat?.();
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&previewId){event.preventDefault();dismissPreview();}
 });
 window.CODYMediaLookup={decorate,present,dismissPreview,activatePreviewAt};
})();
