(() => {
  'use strict';
  const api = window.assistant?.browserPreference;
  if (!api) return;
  const select = document.getElementById('preferred-browser');
  const status = document.getElementById('preferred-browser-status');
  let busy = false;
  let saved;

  function showStatus(message) {
    status.textContent = message || '';
    status.hidden = !message;
  }

  function browserOption(name, id, icon) {
    const option = new Option('', id);
    const entry = document.createElement('span');
    entry.className = 'browser-option';
    const badge = document.createElement('span');
    badge.className = 'browser-option-icon';
    badge.setAttribute('aria-hidden', 'true');
    if (icon) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = icon;
      badge.append(image);
    } else {
      window.CODYIcons.set(badge, 'globe');
    }
    const label = document.createElement('span');
    label.className = 'browser-option-label';
    label.textContent = name;
    entry.append(badge, label);
    option.append(entry);
    return option;
  }

  function replaceOptions(options) {
    for (const option of [...select.options]) option.remove();
    select.append(...options);
  }

  replaceOptions([browserOption('Windows default', 'system')]);

  async function update(load) {
    if (busy) return;
    busy = true;
    try {
      const state = await load();
      const options = [browserOption('Windows default', 'system')];
      for (const browser of state.browsers) options.push(browserOption(browser.name, browser.id, browser.icon));
      if (!options.some(option => option.value === state.selectedId)) {
        const missing = browserOption(state.selectedName + ' (unavailable)', state.selectedId);
        missing.disabled = true;
        options.push(missing);
      }
      replaceOptions(options);
      select.value = saved = state.selectedId;
      select.disabled = false;
      showStatus(state.message || (saved === 'system' && state.effectiveBrowser
        ? 'Windows currently uses ' + state.effectiveBrowser + '.' : ''));
    } catch (error) {
      if (saved) select.value = saved;
      showStatus(error.message);
    } finally {
      busy = false;
    }
  }

  function refresh() {
    if (document.body.classList.contains('settings-open') && !select.closest('.settings-tab').hidden)
      void update(api.state);
  }
  select.addEventListener('change', () => {
    const id = select.value;
    if (busy) {
      select.value = saved;
      return;
    }
    void update(() => api.select(id));
  });
  document.addEventListener('cody:view-changed', refresh);
  document.addEventListener('cody:settings-tab-changed', refresh);
  window.addEventListener('focus', refresh);
})();
