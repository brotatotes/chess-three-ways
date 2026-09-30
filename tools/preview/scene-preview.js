import { createScene } from '../../src/scene/scene.js';
import { newGame } from '../../src/engine/chess.js';
const div = document.createElement('div'); div.style.cssText = 'position:fixed;inset:0'; document.body.appendChild(div);
const S = createScene(div, { preserve: true });
S.setPosition(newGame().board);
S.overlays.set([['last', 12], ['last', 28], ['select', 6], ['hint', 21], ['hint', 23]]);
setTimeout(() => { window.__done = true; }, 1500);
