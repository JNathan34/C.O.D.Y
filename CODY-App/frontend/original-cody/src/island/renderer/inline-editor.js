'use strict';
(() => {
  // A real, editable inline mention cannot live inside a textarea. Keep the
  // existing .value/.disabled contract so voice, drafts and attachment buttons
  // continue to work with the rich composer.
  const editor = document.getElementById('quick-input');
  if (!editor || editor.tagName !== 'DIV') return;

  const isMention = node => node.nodeType === 1 && node.classList.contains('inline-mention');
  function collect(root) {
    const found = {text: '', mentions: []};
    const walk = parent => {
      for (const node of parent.childNodes) {
        if (node.nodeType === 3) found.text += node.nodeValue;
        else if (isMention(node)) found.mentions.push({
          id: node.dataset.capabilityId, name: node.dataset.name,
          icon: node.dataset.icon, ...(node.dataset.logo ? {logo: node.dataset.logo} : {}),
          offset: found.text.length
        });
        else if (node.nodeName === 'BR') found.text += '\n';
        else if (node.nodeType === 1) walk(node);
      }
    };
    walk(root);
    return found;
  }
  const snapshot = () => {
    const state = collect(editor);
    return {text: state.text, mention: state.mentions[0] || null};
  };

  Object.defineProperty(editor, 'value', {
    configurable: true,
    get: () => snapshot().text,
    set(value) {
      const text = String(value ?? '');
      editor.replaceChildren(...(text ? [document.createTextNode(text)] : []));
    }
  });
  let disabled = false;
  Object.defineProperty(editor, 'disabled', {
    configurable: true,
    get: () => disabled,
    set(value) {
      disabled = Boolean(value);
      editor.contentEditable = String(!disabled);
      editor.setAttribute('aria-disabled', String(disabled));
    }
  });

  function badge(mention, editable = false) {
    const span = document.createElement('span');
    span.className = 'inline-mention';
    span.dataset.capabilityId = String(mention.id || '');
    span.dataset.name = String(mention.name || '');
    span.dataset.icon = String(mention.icon || 'plug');
    if (typeof mention.logo === 'string' && /^https:\/\/\S{1,500}$/.test(mention.logo)) span.dataset.logo = mention.logo;
    if (editable) span.contentEditable = 'false';
    span.setAttribute('aria-label', mention.name + ' capability');
    const icon = document.createElement('span');
    icon.className = 'inline-mention-icon';
    icon.setAttribute('aria-hidden', 'true');
    window.CODYIcons?.set(icon, span.dataset.icon);
    if (span.dataset.logo) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = span.dataset.logo;
      image.addEventListener('load', () => icon.replaceChildren(image), {once: true});
    }
    const label = document.createElement('span');
    label.className = 'inline-mention-name';
    label.textContent = String(mention.name || 'Skill');
    span.append(icon, label);
    return span;
  }

  // Count only user-authored text. Embedded mention labels are decorations and
  // never become part of the backend prompt or shift its text offset.
  function locate(offset) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('.inline-mention')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node, remaining = Math.max(0, offset);
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) return {node, offset: remaining};
      remaining -= node.length;
    }
    return {node: editor, offset: editor.childNodes.length};
  }
  function replace(start, end, replacement) {
    const a = locate(start), b = locate(end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    range.deleteContents();
    range.insertNode(replacement);
    range.setStartAfter(replacement);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new Event('input', {bubbles: true}));
  }
  function selectionOffsets() {
    const selection = window.getSelection();
    if (!selection.rangeCount || !editor.contains(selection.anchorNode) ||
        !editor.contains(selection.focusNode)) return null;
    const endOffset = (node, offset) => {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.setEnd(node, offset);
      return collect(range.cloneContents()).text.length;
    };
    return {start: endOffset(selection.anchorNode, selection.anchorOffset),
      end: endOffset(selection.focusNode, selection.focusOffset)};
  }
  function insertMention(mention, start, end) {
    if (disabled || !mention?.id) return false;
    // Only one routed capability per request. Replacing a prior mention leaves
    // the surrounding user's text untouched.
    const prior = editor.querySelector('.inline-mention');
    if (prior) prior.remove();
    replace(start, end, badge(mention, true));
    editor.focus();
    return true;
  }
  function restore({text = '', mention = null} = {}) {
    editor.value = text;
    if (mention && Number.isInteger(mention.offset) && mention.offset >= 0 &&
        mention.offset <= text.length) {
      const at = locate(mention.offset);
      const range = document.createRange();
      range.setStart(at.node, at.offset);
      range.collapse(true);
      range.insertNode(badge(mention, true));
    }
    editor.dispatchEvent(new Event('input', {bubbles: true}));
  }
  function clearMention() {
    for (const node of editor.querySelectorAll('.inline-mention')) node.remove();
    editor.dispatchEvent(new Event('input', {bubbles: true}));
  }
  function insertPlain(text) {
    const selection = window.getSelection();
    if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new Event('input', {bubbles: true}));
  }
  editor.addEventListener('paste', event => {
    const text = event.clipboardData?.getData('text/plain');
    if (text == null) return;
    event.preventDefault();
    insertPlain(text);
  });
  editor.addEventListener('beforeinput', event => {
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault();
      insertPlain('\n');
    }
  });
  window.CODYInlineComposer = Object.freeze({
    snapshot, badge, insertMention, restore, clearMention, selectionOffsets
  });
})();
