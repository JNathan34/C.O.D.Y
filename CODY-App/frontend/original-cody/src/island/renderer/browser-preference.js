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

  async function update(load) {
    if (busy) return;
    busy = true;
    try {
      const state = await load();
      const options = [new Option('Windows default', 'system')];
      for (const browser of state.browsers) options.push(new Option(browser.name, browser.id));
      if (!options.some(option => option.value === state.selectedId)) {
        const missing = new Option(state.selectedName + ' (unavailable)', state.selectedId);
        missing.disabled = true;
        options.push(missing);
      }
      select.replaceChildren(...options);
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
