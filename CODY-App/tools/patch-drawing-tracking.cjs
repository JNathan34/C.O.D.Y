'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {screenMarkState}=require('./drawing-mark-state.cjs');

const assets = path.resolve(__dirname, '../run/current/Assets/Engine');
function insert(file, anchor, code) {
  const filename = path.join(assets, file);
  const source = fs.readFileSync(filename, 'utf8');
  if (source.split(anchor).length !== 2) throw Error('Unexpected drawing runtime: ' + file);
  fs.writeFileSync(filename, source.replace(anchor, () => code + anchor));
}

// Keep mark IDs and their native render units together. Marks attached to a
// paper, photo or model belong to that object, even if they use ring().
insert('clicky-draw-engine.js', '      keepNotesOnly() {', `      codyScreenMarks() {
        const visible = visibleMarkIndexes();
        const onCard = cardTest(visible) || (() => false);
        return visible.flatMap(i => {
          // The revealed stroke's DOM box can be only its lower/right arc.
          // Anchor geometric marks using their complete intended geometry,
          // before the pen animation has finished revealing the outline.
          const m = mark(i), bounds = m.do === 'text' ? box(i) : (markBox(m) || box(i));
          const invisible = m.do === 'dot' && m.fillAlpha === 0 && m.outline === false;
          return !invisible && pointsAtScreen(m) && !isCardMark(m) && bounds && !onCard(bounds)
            ? [{ id: i, role: m.role || '', bounds, nodes: E.NODES[i] }]
            : [];
        });
      },
`);
insert('clicky-draw-engine.js', '      cardsNow: () => ed.cardsNow(),', '      codyScreenMarks: () => ed.codyScreenMarks(),\n');
insert('clicky-draw-native.js', '    setPieces(source)', `    codyScreenMarks() {
      return JSON.stringify((${screenMarkState.toString()})(session, unitOf));
    },
`);
