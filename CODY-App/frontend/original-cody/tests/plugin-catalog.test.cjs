'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizePluginCatalog,cloudWordPresentation}=require('../src/plugin-catalog');
const {normalizeMentions}=require('../src/mentions-normalize');
const {localMentions}=require('../src/mentions');

test('cloud Word presentation corrects misleading metadata while retaining connection and account identities',()=>{
  const word={id:'microsoft_word',kind:'cloud',name:'Microsoft Word',description:'Inspect projects, code, issues, pull requests and deployments.',connected:true,accounts:[{id:'account-one',name:'Personal'}],canAddAccount:true,logo:'https://example.org/word.png'};
  const other={id:'wordpress',kind:'cloud',name:'WordPress',description:'Publish posts.'};
  const catalog={signedIn:true,plugins:[word,other],custom:[{id:'custom:word',name:'Word'}]};
  const result=normalizePluginCatalog(catalog);
  assert.equal(result.plugins.length,2);assert.equal(result.plugins[0].name,'Microsoft Word (Cloud)');
  assert.match(result.plugins[0].description,/Word \(Desktop\)/);assert.doesNotMatch(result.plugins[0].description,/code|deployments/);
  for(const key of ['id','connected','accounts','canAddAccount','logo'])assert.equal(result.plugins[0][key],word[key]);
  assert.equal(result.plugins[1],other);assert.equal(result.custom,catalog.custom);
  assert.equal(word.name,'Microsoft Word','upstream records remain untouched');
});

test('desktop and cloud Word mentions remain distinct and route by their unchanged IDs',()=>{
  const items=normalizeMentions([{id:'plugin:microsoft_word',kind:'plugin',name:'Microsoft Word',description:'wrong description',logo:'https://example.org/word.png'}],localMentions);
  assert.equal(items.find(item=>item.id==='plugin:word').name,'Word (Desktop)');
  assert.equal(items.find(item=>item.id==='plugin:microsoft_word').name,'Microsoft Word (Cloud)');
  assert.equal(items.filter(item=>/Word/.test(item.name)).length,2);
});

test('catalogue correction leaves custom plugins, similarly named apps and invalid records to existing validation',()=>{
  for(const item of [null,undefined,{}, {name:'WordPress',kind:'cloud'}, {name:'Word',kind:'custom'}, {id:'plugin:custom:one',kind:'plugin',name:'Word'}, {id:'plugin:word',kind:'plugin',name:'Word'}])assert.equal(cloudWordPresentation(item),item);
  assert.deepEqual(normalizeMentions([null,{}, {id:'bad id',name:'Microsoft Word',kind:'plugin'}]),[]);
  assert.equal(normalizePluginCatalog(null),null);
});

test('the built-in WhatsApp plugin replaces the old Business entry in settings and chat mentions',()=>{
  const legacy=[{id:'whatsapp',name:'WhatsApp Business',kind:'cloud',connected:true},
    {id:'whatsapp_business',name:'WhatsApp Business Cloud',kind:'cloud'},
    {id:'business-provider',name:'WhatsApp Business',kind:'cloud'}];
  const unrelated={id:'facebook',name:'Facebook',kind:'cloud'};
  const custom=[{id:'custom:one',name:'WhatsApp Business',kind:'custom'}];
  const catalog=normalizePluginCatalog({plugins:[...legacy,unrelated],custom});
  assert.deepEqual(catalog.plugins,[unrelated]);assert.equal(catalog.custom,custom);
  const entries=legacy.map(entry=>({...entry,id:'plugin:'+entry.id,kind:'plugin'}));
  entries.push({id:'skill:whatsapp_business',name:'WhatsApp Business Skill',kind:'skill'},
    {id:'plugin:custom:one',name:'WhatsApp Business',kind:'plugin'});
  const items=normalizeMentions(entries,localMentions);
  assert.deepEqual(items.filter(item=>item.name.startsWith('WhatsApp')).map(item=>item.id),['plugin:whatsapp-drafts','plugin:custom:one']);
});
