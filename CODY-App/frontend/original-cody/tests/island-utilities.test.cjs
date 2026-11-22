'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {IslandUtilities}=require('../src/island-utilities');
function setup(overrides={}){
  const cards=[],actions=[];let cleared=0;
  const services={now:()=>new Date('2026-10-28T12:34:00Z'),weather:{current:async()=>({reply:'London: 12°C, clear skies.',card:{kind:'weather',text:'12°C',detail:'London',icon:'sun'}})},timer:{execute:()=> 'Timer started.'},spotify:{snapshot:()=>({available:true,title:'Track',artist:'Artist',playing:false,source:'test.player'})},controller:{execute:async(action,args)=>{actions.push({action,args});return {ok:true};}},audioState:async()=>({level:42,muted:false}),showCard:card=>cards.push(card),clearCard:()=>cleared++,refreshMedia:()=>{},...overrides};
  return {utilities:new IslandUtilities(services),cards,actions,cleared:()=>cleared};
}
test('clock, date, weather and maths publish the original Island card formats',async()=>{
  const {utilities,cards}=setup();
  for(const prompt of ["what's the time?","what's the date?",'weather in London','12 * 4'])assert.equal((await utilities.run(prompt,'chat')).handled,true);
  assert.deepEqual(cards.map(c=>c.kind),['time','date','weather','utility']);assert.equal(cards[2].text,'12°C');assert.match(cards[3].text,/48/);
});
test('ordinary AI questions stay with HeyClicky',()=>{const {utilities}=setup();for(const prompt of ['Explain why weather changes','Draw a 3D bicycle','Write a song about time','Set volume to 25 and email my manager'])assert.equal(utilities.match(prompt),null);});
test('natural questions about current Plex viewers return cards and a spoken summary',async()=>{
  let calls=0;
  const session={viewer:'Plex Viewer',title:'Fixture Movie',state:'playing',poster:'data:image/png;base64,YQ=='};
  const {utilities,cards}=setup({selfHosted:{plexSessions:async({artwork})=>{
    assert.equal(artwork,true);calls++;return {count:1,sessions:[session]};
  }},overseerrRequests:{lookup:()=>assert.fail('Plex activity is a server session lookup')}});
  const prompts=['is anyone watching plex','Is anybody watching on Plex right now?',
    'Can you check if anyone is watching my Plex server?', 'Show me who’s watching Plex', 'How many people are watching Plex?', 'Plex sessions',
    'whose watching plex', 'Whos currently watching on my Plex server?', 'Who watching Plex now?',
    'Who on Plex is streaming something?', 'How many active streams does Plex have?', 'Which movie is playing on Plex?'];
  for(const prompt of prompts){
    assert.equal(utilities.match(prompt).action,'self-hosted-plex-sessions',prompt);
    const result=await utilities.run(prompt,'plex-chat');
    assert.equal(result.reply,'1 Plex viewing session right now.');
    assert.match(result.confirmation,/Plex Viewer is watching Fixture Movie/);
    assert.deepEqual(result.mediaLookup,{sessions:[session],count:1});
  }
  assert.equal(calls,prompts.length);
  assert.equal(cards.length,0); // The assistant message supplies the poster preview.
  assert.equal(utilities.match('Is Dune on Plex?').action,'overseerr-availability');
  assert.equal(utilities.match('Who owns Plex?'),null);
  assert.equal(utilities.match('Whose Plex server is this?'),null);
  assert.equal(utilities.match('Check the Plex activity').action,'self-hosted-plex-sessions');
  assert.equal(utilities.match('Can you use the Plex plugin to check who’s watching right now?').action,'self-hosted-plex-sessions');
  assert.equal(utilities.match('Check who’s watching with the Plex plug-in.').action,'self-hosted-plex-sessions');
  assert.equal(utilities.match('Is Dune on Plek?').action,'overseerr-availability');
});
test('Plex follow-up repair needs a recent Plex activity request in the same chat',()=>{
  const {hasRecentPlexRequest,isPlexSessionRequest}=require('../src/media-commands');
  const prompt={role:'user',text:'Who’s watching Plek?',at:'2026-11-22T08:00:00Z'};
  const followup='Is washing collect?';
  const now=Date.parse('2026-11-22T08:01:00Z');
  assert.equal(hasRecentPlexRequest([prompt],now),true);
  assert.equal(hasRecentPlexRequest([prompt],now+10*60000),false);
  assert.equal(hasRecentPlexRequest([prompt,{role:'user',text:'How hot should I wash wool?'}],now),false);
  assert.equal(isPlexSessionRequest(followup,{spoken:true,plexContext:true}),true);
  assert.equal(isPlexSessionRequest(followup,{spoken:true,plexContext:false}),false);
  assert.equal(isPlexSessionRequest('Is anyone washing clothes?',{spoken:true,plexContext:true}),false);
});
test('recent request questions use the connected Overseerr server before title lookup',async()=>{
  const selfHosted={data:{overseerr:{}},overseerrRequests:async()=>[{title:'Fixture Film',status:1},{title:'Fixture Show',status:5}]};
  const {utilities,cards}=setup({selfHosted,overseerrRequests:{lookup:()=>assert.fail('Recent requests should not trigger a title lookup')}});
  for(const prompt of ['show me recent requests','Could you show me the latest Overseerr requests?',
    'Check recent requests on Overseerr','What are my latest media requests?', 'What’s been requested on Overseerr recently?', 'overseerr requests',
    'Any requests on Overseer?','Check overseer.','Are there any requests on the Overseer server?',
    'Show me the pending requests in Overseerr', 'What pending requests are there on Overseerr?']){
    assert.equal(utilities.match(prompt).action,'self-hosted-overseerr-requests',prompt);
    const result=await utilities.run(prompt);
    assert.match(result.reply,/Fixture Film · Pending approval.*Fixture Show · Completed/s);
  }
  assert.equal(cards.at(-1).detail,'Overseerr');
  assert.equal(utilities.match('Show me recent API requests'),null);
  assert.equal(utilities.match('Show recent requests on Jira'),null);
  assert.equal(utilities.match('Is Dune on Plex?').action,'overseerr-availability');
  delete selfHosted.data.overseerr;
  assert.equal(utilities.match('show me recent requests'),null);
  assert.equal(utilities.match('show me recent requests on Overseerr').action,'self-hosted-overseerr-requests');
});
test('Plex availability and Overseerr lookups use the same title search',async()=>{
  const queries=[];
  const {utilities}=setup({selfHosted:{plexSessions:()=>assert.fail('Availability is not a session lookup')},
    overseerrRequests:{lookup:async args=>{queries.push(args.query);return {reply:'Available on Plex'};}}});
  const prompts=['Is Dune on Plex?','Do I have Dune on Plex?','Is Dune on Overseer?','Check Overseer for Dune.',
    'Does our Plex server have Dune?', 'Can I watch Dune through Plex yet?', 'On Plex, can we stream Dune?',
    'Has Dune been added to Plex yet?', 'Check whether Dune was recently added to Plex',
    'Check my Plex library to see if it has Dune', 'Confirm that Plex has Dune.',
    'Could you tell me whether Dune is on Plex?', 'Does Plex still have Dune?'];
  for(const prompt of prompts)
    assert.equal((await utilities.run(prompt)).reply,'Available on Plex');
  assert.equal((await utilities.run('Is The Overseer on Plex?')).reply,'Available on Plex');
  assert.equal((await utilities.run('Is Open Water on Plex?')).reply,'Available on Plex');
  assert.equal((await utilities.run('Is What Love Is on Plex?')).reply,'Available on Plex');
  assert.deepEqual(queries,[...prompts.map(()=> 'Dune'),'The Overseer','Open Water','What Love Is']);
  for(const prompt of ['Why does Plex buffer?', 'Help me with Plex', 'What is new about Plex?', 'Does Plex have Dune and open Word?'])
    assert.equal(utilities.match(prompt),null,prompt);
});
test('natural questions about recent library additions use Plex directly',async()=>{
  const {utilities}=setup({
    selfHosted:{plexRecent:async()=>[{title:'Fixture Film'}]},
    overseerrRequests:{lookup:()=>assert.fail('Recent additions come from Plex')}
  });
  for(const prompt of ['What movies has Plex added lately?', 'What’s new in our Plex library?',
    'Which titles have been added on Plex?', 'Show me Plex’s latest additions']){
    assert.equal(utilities.match(prompt)?.action,'self-hosted-plex-recent',prompt);
    assert.equal((await utilities.run(prompt)).reply,'Recently added to Plex: Fixture Film.');
  }
});
test('media follow-ups use the previous availability turn and keep its topic within the chat',()=>{
  const {hasPlexAvailabilityContext}=require('../src/media-commands');
  const {utilities}=setup({selfHosted:{},overseerrRequests:{}});
  const availability=[{role:'user',text:'Is the latest Spider-Man movie on Plex?'},{role:'assistant',text:'Available.'}];
  assert.equal(hasPlexAvailabilityContext(availability),true);
  const followUp='What about The Odyssey?';
  assert.equal(utilities.match(followUp),null);
  assert.deepEqual(utilities.match(followUp,{availabilityContext:hasPlexAvailabilityContext(availability)}).args,
    {query:'The Odyssey',latest:false,type:null,year:''});
  const continued=[...availability,{role:'user',text:followUp},{role:'assistant',plexAvailability:true,text:'No matches found.'}];
  assert.equal(hasPlexAvailabilityContext(continued),true);
  assert.equal(utilities.match('How about Dune Part Two?',{availabilityContext:true}).args.query,'Dune Part Two');
  assert.equal(hasPlexAvailabilityContext([...continued,{role:'user',text:'What time is it?'},{role:'assistant',text:'Nine.'}]),false);
  assert.equal(hasPlexAvailabilityContext([{role:'assistant',mediaLookup:{sessions:[],count:0}}]),false);
  assert.equal(hasPlexAvailabilityContext([]),false);
  assert.equal(utilities.match('What about the weather?',{availabilityContext:true}),null);
  assert.equal(utilities.match('and open Word',{availabilityContext:true}),null);
  assert.equal(utilities.match('Is the odysseum plex?').args.query,'the Odyssey');
});
test('media commands target the actual player and clear an older quick card',async()=>{const {utilities,actions,cleared}=setup();await utilities.run('pause my music','chat');assert.deepEqual(actions,[{action:'media.control',args:{command:'pause',target:'current'}}]);assert.equal(cleared(),1);});
test('volume cards use the actual resulting volume, including relative changes',async()=>{const {utilities,cards,actions}=setup();await utilities.run('turn the volume down by 10 percent','chat');assert.deepEqual(actions,[{action:'audio.set',args:{level:32}}]);assert.equal(cards.at(-1).text,'42%');});
test('mirroring a spoken action never executes the action a second time',async()=>{const {utilities,actions,cards}=setup();await utilities.observe('skip track');await utilities.observe('set volume to 80 percent');assert.equal(actions.length,0);assert.equal(cards.at(-1).text,'42%');});
test('weather failure shows an unavailable card rather than invented conditions',async()=>{const {utilities,cards}=setup({weather:{current:async()=>{throw Error('Weather timed out');}}});const result=await utilities.run('weather in London');assert.equal(result.error,true);assert.equal(cards.at(-1).text,'Unavailable');assert.equal(cards.at(-1).tooltip,'Weather timed out');});
test('starting a timer clears a weather card so the countdown is visible',async()=>{const {utilities,cleared}=setup();assert.equal((await utilities.run('set a timer for 1 minute','chat')).handled,true);assert.equal(cleared(),1);});
test('denied media controls are reported without claiming playback changed',async()=>{const {utilities,cards}=setup({controller:{execute:async()=>({cancelled:true})}});const result=await utilities.run('pause music');assert.equal(result.cancelled,true);assert.equal(cards.length,0);});
test('a late weather response cannot replace a newer time card',async()=>{let resolve;const weather={current:()=>new Promise(r=>resolve=r)};const {utilities,cards}=setup({weather});const pending=utilities.run('weather in London');await utilities.run("what's the time?");resolve({reply:'Old result',card:{kind:'weather',text:'Old result'}});await pending;assert.equal(cards.length,1);assert.equal(cards[0].kind,'time');});
test('cancelling during a volume lookup prevents the later Windows action',async()=>{let resolve;const {utilities,actions,cards}=setup({audioState:()=>new Promise(r=>resolve=r)});const pending=utilities.run('turn the volume down');utilities.cancel();resolve({level:50,muted:false});const result=await pending;assert.equal(result.cancelled,true);assert.equal(actions.length,0);assert.equal(cards.length,0);});
test('broader volume requests handled by HeyClicky still show actual Island state',async()=>{const {utilities,actions,cards}=setup();await utilities.observe('increase the music volume a little');assert.equal(cards.at(-1).text,'42%');assert.equal(actions.length,0);});
test('common volume phrasings use the direct route while compound requests do not',()=>{const {utilities}=setup();for(const prompt of ['volume up','turn up the volume','increase the volume','raise the music a little'])assert.equal(utilities.match(prompt).delta,10);for(const prompt of ['turn down the sound','lower the volume','volume down'])assert.equal(utilities.match(prompt).delta,-10);assert.equal(utilities.match('increase the volume and send an email'),null);});
test('unverified app requests show a pending card instead of falsely claiming success',async()=>{const {utilities,cards,actions}=setup();await utilities.run('could you open the calculator app for me');assert.deepEqual(actions,[{action:'app.open',args:{app:'calculator'}}]);assert.deepEqual(cards.at(-1),{kind:'utility',text:'Opening',detail:'Calculator',icon:'external-link'});assert.equal(utilities.match('open Google Chrome').args.app,'chrome');});
test('apps opened by HeyClicky get a card after verification and are not relaunched',async()=>{const actions=[];const {utilities,cards}=setup({controller:{execute:async(action,args)=>{actions.push(action);return {ok:true,result:[{process:'Plezy',title:'Home'}]};}}});await utilities.observe('open Plezy');assert.deepEqual(actions,['app.list']);assert.equal(cards.at(-1).text,'Opened');assert.equal(cards.at(-1).detail,'Plezy');});
test('a failed launch or unrelated window cannot produce an Opened card',async()=>{const {utilities,cards}=setup({controller:{execute:async action=>action==='app.list'?{ok:true,result:[{process:'firefox',title:'Plezy documentation — Mozilla Firefox'}]}:{ok:false,error:'App could not start'}}});await utilities.run('open calculator');assert.equal(cards.at(-1).text,'Unavailable');cards.length=0;await utilities.observe('open Plezy');assert.equal(cards.length,0);});
