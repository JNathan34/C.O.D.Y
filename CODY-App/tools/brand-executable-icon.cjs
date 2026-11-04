'use strict';
const fs = require('node:fs');
const {NtExecutable, NtExecutableResource, Data, Resource} = require('resedit');

function brandExecutableIcon(file, icon) {
  // The original apphost has a neutral-language icon (32512). rcedit adds
  // an English icon (1), leaving Windows free to select the original one.
  // Replace every group, including its original language, instead.
  const executable = NtExecutable.from(fs.readFileSync(file), {ignoreCert: true});
  const resources = NtExecutableResource.from(executable);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  const icons = Data.IconFile.from(fs.readFileSync(icon)).icons.map(item => item.data);
  // Remove old images too: Windows may resolve an image ID through a
  // different language than its group, so orphaned images can still appear.
  resources.entries = resources.entries.filter(entry => entry.type !== 3 && entry.type !== 14);
  for (const group of groups.length ? groups : [{id: 1, lang: 0}]) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  }
  resources.outputResource(executable);
  fs.writeFileSync(file, Buffer.from(executable.generate()));
}

module.exports = {brandExecutableIcon};
