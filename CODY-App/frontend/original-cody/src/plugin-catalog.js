'use strict';

const oldWhatsAppSlugs=new Set(['whatsapp','whatsappbusiness','whatsappbusinesscloud','whatsappbusinesscloudapi','whatsappcloudapi','whatsappbusinessskill']);
function isReplacedWhatsAppPlugin(entry){
  if(!['cloud','plugin','skill'].includes(entry?.kind)||typeof entry.id!=='string'||/^(?:plugin:)?custom:/i.test(entry.id))return false;
  const slug=value=>String(value||'').toLowerCase().replace(/^(?:plugin|skill):/,'').replace(/[\s_-]/g,'');
  return oldWhatsAppSlugs.has(slug(entry.id))||oldWhatsAppSlugs.has(slug(entry.name));
}

function cloudWordPresentation(entry){
  const cloud=entry?.kind==='cloud'||(entry?.kind==='plugin'&&typeof entry.id==='string'&&entry.id.startsWith('plugin:')&&entry.id!=='plugin:word'&&!entry.id.startsWith('plugin:custom:'));
  if(!cloud||typeof entry.name!=='string'||!/^(?:microsoft\s+)?word$/i.test(entry.name.trim()))return entry;
  return {...entry,name:'Microsoft Word (Cloud)',description:'Account-based Word integration. For the Word document open on this PC, use Word (Desktop).'};
}

function normalizePluginCatalog(catalog){
  if(!catalog||!Array.isArray(catalog.plugins))return catalog;
  return {...catalog,plugins:catalog.plugins.filter(entry=>!isReplacedWhatsAppPlugin(entry)).map(cloudWordPresentation)};
}

module.exports={cloudWordPresentation,normalizePluginCatalog,isReplacedWhatsAppPlugin};
