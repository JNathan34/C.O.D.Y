(() => {
  'use strict';
  const api = window.assistant?.mentions;
  if (!api) return;

  const input = document.getElementById('quick-input');
  const menu = document.getElementById('mention-picker');
  const results = document.getElementById('mention-results');
  const status = document.getElementById('mention-status');
  const composer = window.CODYInlineComposer;
  let token, active = 0, matches = [], inventory = [], loading = false, error = '';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(item) {
    const badge = element('span', 'mention-icon');
    badge.setAttribute('aria-hidden', 'true');
    window.CODYIcons.setMention(badge,item);
    return badge;
  }

  function close() {
    token = null;
    menu.hidden = true;
    input.removeAttribute('aria-activedescendant');
  }

  function clear() {
    close();
    composer?.clearMention();
  }

  function markActive(scroll = false) {
    for (const option of results.children) option.setAttribute('aria-selected', 'false');
    input.removeAttribute('aria-activedescendant');
    const option = results.children[active];
    if (!option) return;
    option.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({block:'nearest'});
  }

  function choose(item) {
    if (!token || !item || input.disabled) return;
    // Insert a non-editable inline entity at the @ token, not a detached row.
    if (!composer?.insertMention(item, token.start, token.end)) return;
    close();
    window.CODYIsland?.updateInput();
    input.focus();
  }

  function render() {
    if (!token) return;
    menu.hidden = false;
    const query = token.query.toLocaleLowerCase();
    const previous = matches[active]?.id;
    const candidates = new Map(inventory.map(item => [item.id, item]));
    matches = [...candidates.values()]
      .filter(item => [item.name, item.description, item.kind].some(value => value?.toLocaleLowerCase().includes(query)))
      .sort((a,b) => Number(b.name.toLocaleLowerCase().startsWith(query)) - Number(a.name.toLocaleLowerCase().startsWith(query)) || a.name.localeCompare(b.name))
      .slice(0, 40);
    active = Math.max(0, matches.findIndex(item => item.id === previous));
    results.replaceChildren(...matches.map((item, index) => {
      const row = element('div', 'mention-result');
      row.role = 'option';
      row.id = 'mention-result-' + index;
      const label = element('span', 'mention-label');
      label.append(element('strong', '', item.name), element('small', '', item.description));
      row.append(icon(item), label, element('span', 'mention-kind', item.kind));
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('click', () => choose(item));
      return row;
    }));
    status.textContent = loading ? 'Loading mentions…' : error ||
      (matches.length ? '' : 'No matching mentions.');
    status.hidden = !status.textContent;
    markActive();
  }

  async function load() {
    if (loading) return;
    loading = true;
    error = '';
    try {
      const local = await api.list(true);
      inventory = local.items;
      render();
      const catalog = await api.list();
      inventory = catalog.items;
      error = catalog.error || '';
    } catch {
      error = 'Could not load available mentions.';
    } finally {
      loading = false;
      render();
    }
  }

  function update() {
    const selection = composer?.selectionOffsets();
    if (!selection || selection.start !== selection.end || input.disabled) { close(); return; }
    const end = selection.end;
    // The boundary excludes email addresses such as name@example.com.
    const match = /(?:^|[\s([{])@([\p{L}\p{N}_-]*)$/u.exec(input.value.slice(0, end));
    if (!match) { close(); return; }
    const opening = !token;
    const suffix = /^[\p{L}\p{N}_-]*/u.exec(input.value.slice(end))[0];
    token = {start: end - match[1].length - 1, end: end + suffix.length, query: match[1]};
    if (opening) void load();
    render();
  }

  input.addEventListener('input', event => { if (!event.isComposing) update(); });
  input.addEventListener('compositionend', update);
  input.addEventListener('click', update);
  input.addEventListener('keyup', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) update(); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (!token || event.isComposing || event.shiftKey || !['Enter','ArrowUp','ArrowDown','Escape','Tab'].includes(event.key)) return;
    if (event.key === 'Tab' && !matches.length) { close(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'Enter' || event.key === 'Tab') { choose(matches[active]); return; }
    if (!matches.length) return;
    active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    markActive(true);
  }, true);
  document.addEventListener('cody:view-changed', event => { if (event.detail !== 'chat' && event.detail !== 'history') close(); });
  window.CODYMentions = Object.freeze({selected: () => composer?.snapshot().mention?.id, snapshot: () => composer?.snapshot().mention, clear});
})();
