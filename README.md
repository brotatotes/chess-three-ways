# Chess, Three Ways

A 3D chess game for the browser with three ways to play:

- **Classic.** Full chess with every rule, move hints and undo.
- **Fog of War.** You only see what your own pieces can see. There is no check, and capturing the king wins.
- **Simultaneous.** Both players secretly choose a move, then both moves happen at once. Pieces that collide fight it out by strength.

Play against the computer on Easy, Medium or Hard, or pass one device back and forth.

**Play it here:** https://brotatotes.github.io/chess-three-ways/

It works on desktop and phones, with mouse, touch or keyboard. Sound and music are made live in the browser and stay off until you turn them on.

## How it is built

The whole game is one self-contained `index.html` with no network requests, so it also works when opened straight from disk.

- `src/engine/` holds the rules for all three modes with no browser code.
- `src/ai/` holds the computer opponents, which run in a Web Worker.
- `src/scene/` builds the board, the procedurally modelled pieces and the effects with Three.js.
- `src/audio/` synthesises every sound and the music with Web Audio.
- `tests/` covers the rules (including perft counts), the resolver for Simultaneous, the AI and the audio.
- `tools/` holds the balance-testing and self-play harnesses.

```
npm install
npm test
node build.mjs      # writes dist/index.html
```

`index.html` at the top of the repository is a copy of `dist/index.html`.

## Credits

- [Three.js](https://threejs.org), MIT License. See `vendor/three/LICENSE`.
- [EB Garamond](https://github.com/octaviopardo/EBGaramond12) by Georg Duffner and Octavio Pardo, SIL Open Font License 1.1, embedded as a subset.
