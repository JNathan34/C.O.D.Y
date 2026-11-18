'use strict';

function cloudWordPresentation(entry){
  const cloud=entry?.kind==='cloud'||(entry?.kind==='plugin'&&typeof entry.id==='string'&&entry.id.startsWith('plugin:')&&entry.id!=='plugin:word'&&!entry.id.startsWith('plugin:custom:'));
  if(!cloud||typeof entry.name!=='string'||!/^(?:microsoft\s+)?word$/i.test(entry.name.trim()))return entry;
  return {...entry,name:'Microsoft Word (Cloud)',description:'Account-based Word integration. For the Word document open on this PC, use Word (Desktop).'};
}

function normalizePluginCatalog(catalog){
  if(!catalog||!Array.isArray(catalog.plugins))return catalog;
  return {...catalog,plugins:catalog.plugins.map(cloudWordPresentation)};
}

module.exports={cloudWordPresentation,normalizePluginCatalog};
