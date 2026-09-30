import { build } from 'esbuild'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { writeFileSync } from 'node:fs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const r = await build({ entryPoints: [path.join(root, 'tools/preview/pieces-preview.js')], bundle: true, write: false, format: 'iife', alias: { three: path.join(root, 'vendor/three/three.module.js') }, logLevel: 'warning' });
writeFileSync(process.argv[2], `<!doctype html><body style="margin:0"><script>${r.outputFiles[0].text}</script>`);
