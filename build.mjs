// Build: bundles the game and the AI worker with esbuild and inlines both into
// one self-contained dist/index.html. Usage: node build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const alias = { three: path.join(root, 'vendor/three/three.module.js') };
const common = { bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, legalComments: 'none', alias, logLevel: 'warning' };

const worker = await build({ ...common, entryPoints: [path.join(root, 'src/ai/worker.js')] });
const workerCode = worker.outputFiles[0].text;

const app = await build({
  ...common,
  entryPoints: [path.join(root, 'src/main.js')],
  define: { __WORKER_SOURCE__: JSON.stringify(workerCode) },
});
const appCode = app.outputFiles[0].text;

const license = readFileSync(path.join(root, 'vendor/three/LICENSE'), 'utf8').trim();
const css = readFileSync(path.join(root, 'src/style.css'), 'utf8');
let html = readFileSync(path.join(root, 'src/index.html'), 'utf8');
const fontPath = path.join(root, 'src/fonts.css');
const fonts = existsSync(fontPath) ? readFileSync(fontPath, 'utf8') : '';
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
html = html
  .replace('/*FONTS*/', () => fonts)
  .replace('/*STYLE*/', () => css)
  .replace('/*APP*/', () => `/*! Three.js (https://threejs.org) is included under the MIT License:\n${license}\n*/\n` + safe(appCode));
const outFile = process.env.CHESS_OUT || path.join(root, 'dist/index.html');
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB (worker ${(workerCode.length / 1024).toFixed(0)} KB)`);
