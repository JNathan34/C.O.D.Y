'use strict';
// Personal Codex is opt-in through the persisted Agents provider selection.
// Starting CODY in Claude or ChatGPT mode must not consume personal Codex usage.
let PERSONAL_CODEX_ENABLED=false;
function setPersonalCodexEnabled(enabled){PERSONAL_CODEX_ENABLED=enabled===true;}
function requirePersonalCodex(){if(!PERSONAL_CODEX_ENABLED)throw Error('Personal Codex usage is disabled. Select ChatGPT Codex in Settings → Agents first.');}
module.exports={get PERSONAL_CODEX_ENABLED(){return PERSONAL_CODEX_ENABLED;},requirePersonalCodex,setPersonalCodexEnabled};
