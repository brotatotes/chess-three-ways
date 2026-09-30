# Acceptance checks

## Rules
- Perft from the start position, depths 1–4: 20, 400, 8902, 197281.
- Kiwipete perft, depths 1–3: 48, 2039, 97862.
- Position 3 (`8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -`), depths 1–4: 14, 191, 2812, 43238. Position 4 with promotions (`r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1`), depths 1–3: 6, 264, 9467.
- Checkmate, stalemate, threefold repetition, the fifty-move rule and insufficient material are each detected by a unit test.
- Fog: visibility matches the design on hand-built positions, king capture ends the game, and castling through attack is allowed.
- Simultaneous: one unit test for each numbered rule, including swap, same-destination by strength, equal-strength mutual removal, missed capture, pawn diagonal miss, sliding through a vacated or entered square, castling collision, promotion collision, king capture, double king capture draw and forced pass.

## AI
- Classic, Fog and Simultaneous AI run in a Web Worker.
- Fog AI chooses the same move for two different true boards that share an observation.
- Hard beats Easy in most games of a quick self-play match in each mode.
- Hard move time is under about 2 s on this VM, measured.

## Look and feel
- Screenshots at 1440×900, 390×844 and 844×390 are reviewed with vision and the review is written down honestly.
- Pieces are recognisable at a glance from the default camera.
- No page errors. A few moves play in every mode through the real UI.
- Animations are captured as frame sequences and reviewed. Reduce animations and `prefers-reduced-motion` are honoured.

## Audio
- No AudioContext exists before the user turns sound on.
- Settings persist across reloads.
- Offline renders of each effect and a music excerpt are non-silent, and their peak is below 0 dBFS.

## Balance
- Simultaneous AI-vs-AI across random, greedy, Easy, Medium, Hard, king-hunt and turtle strategies. No strategy wins every game, the colour advantage is modest, and draws and loops are not dominant.
- Fog sanity check for an obvious always-win.

## Delivery
- One `dist/index.html` works from `file://` with no network requests.
- Full games to completion in each mode against the computer, plus one pass-and-play game, on desktop and phone emulation. Undo, promotion, settings, sound, reduced motion, resize and the low-quality path are exercised.
- No private paths or secrets in the product.
- Public repo, live Pages verified on desktop and phone with a matching HTML hash, home card at the top of Games & Experiments verified live.
