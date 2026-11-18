const activeField = 'let field=document.activeElement; while(field?.shadowRoot?.activeElement) field=field.shadowRoot.activeElement;';
const supported = `field && field.isConnected && !field.disabled && !field.readOnly && field.type !== 'password' &&
  !/one-time-code|cc-number|cc-csc/.test(field.autocomplete || '') &&
  (field.isContentEditable || field instanceof HTMLTextAreaElement ||
   (field instanceof HTMLInputElement && ['text','search','url','tel','email','number'].includes(field.type)))`;

export const focusTextField = `function(text) {
  const field=this;
  if (field instanceof HTMLSelectElement && field.isConnected && !field.disabled) {
    const wanted = text.trim().toLowerCase();
    const available = [...field.options].filter(option=>!option.disabled && !option.parentElement?.disabled);
    const match = available.find(option=>option.text.trim().toLowerCase()===wanted||option.value.toLowerCase()===wanted)
      || available.find(option=>option.text.trim().toLowerCase().startsWith(wanted));
    if(!match) return 'unavailable';
    field.value=match.value;
    field.focus();
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.dispatchEvent(new Event('change',{bubbles:true}));
    return 'selected';
  }
  if (!(${supported})) return 'unavailable';
  field.scrollIntoView({block:'nearest',inline:'nearest'});
  field.focus();
  return 'focused';
}`;

export async function enterBrowserText(command, send, text, expectedObject) {
  const field = expectedObject || (await command('Runtime.evaluate', {
    expression:'(() => {' + activeField + 'return field;})()'
  }, true))?.result?.objectId;
  if (!field) throw new Error('Click the intended editable field before typing.');
  async function inspect(body) {
    const result = await command('Runtime.callFunctionOn', {
      objectId:field, returnByValue:true,
      functionDeclaration:'function(){' + activeField + 'if (field!==this || !(' + supported + ')) return null; ' + body + '}'
    }, true);
    if (result?.exceptionDetails || result?.result?.value == null)
      throw new Error('The field is protected, unavailable, or lost focus. Check for partial text before retrying.');
    return result.result.value;
  }
  try {
    const before = await inspect(`
      if (field.isContentEditable) {
        const selection=field.ownerDocument.getSelection();
        if (!selection?.rangeCount || !field.contains(selection.anchorNode) || !field.contains(selection.focusNode)) return null;
        if (!selection.isCollapsed) selection.collapseToEnd();
        return {verify:false};
      }
      const end=field.selectionEnd;
      if (end===null && field.value) return null;
      if (end!==null && field.selectionStart!==end) field.setSelectionRange(end,end);
      return {verify:true,value:field.value,end:end??0};
    `);
    for (const {segment} of new Intl.Segmenter().segment(text)) {
      await inspect('return true;');
      await send(segment);
    }
    if (before.verify) {
      const actual = await inspect('return field.value;');
      if (actual !== before.value.slice(0,before.end)+text+before.value.slice(before.end))
        throw new Error('The browser did not confirm the text. Check the field before retrying.');
    }
  } finally {
    if (!expectedObject) await command('Runtime.releaseObject',{objectId:field}).catch(()=>{});
  }
}
