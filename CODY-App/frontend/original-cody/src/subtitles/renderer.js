'use strict';

const caption = document.getElementById('caption');
window.subtitles.onText(text => { caption.textContent = text; });
