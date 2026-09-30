# Chess, Three Ways — Design

A 3D browser chess game with three modes in one self-contained `index.html`. Every mode is playable against the computer (Easy, Medium, Hard) or as pass-and-play on one device. No server, no network, no downloads at runtime.

## Modes

### Classic
Full FIDE rules: castling, en passant, promotion with a choice of piece, check, checkmate, stalemate, threefold repetition, fifty-move rule and insufficient material (K v K, K+minor v K, K+B v K+B same colour). Selecting a piece shows its legal destinations. Undo is always available against the computer (undoes your move and the reply) and in pass-and-play (one ply).

### Fog of War
Standard dark chess.
- Moves are pseudo-legal. There is no check, and a king may move into or stay in attack. Capturing the king wins.
- Castling needs an unmoved king and rook and empty squares between them. Attacked squares do not matter.
- En passant and promotion work as usual.
- **Visibility for a side** is the union of the squares its own pieces stand on, every square those pieces can pseudo-legally move to (including captures, en passant and castling destinations), and the two forward diagonal squares of each own pawn. Enemy pieces are shown only on visible squares. Everything else is under fog.
- A side with no pseudo-legal moves draws. The fifty-move rule and threefold repetition also draw, judged on the full position.
- Undo is available only against the computer. Pass-and-play uses a cover screen between turns.

### Simultaneous
Both sides secretly pick one move, then both moves resolve at once. The board is fully visible. Moves are chosen as pseudo-legal moves from the position at the start of the turn. There is no check and capturing the king wins.

Resolution, applied in this order:
1. **Paths are judged from the start of the turn.** A slider may pass through a square the other side is moving into, or one it is leaving. Moves are simultaneous, so nothing blocks mid-move.
2. **Swap.** If White's piece moves to Black's piece's start square and that Black piece moves to White's piece's start square, they meet halfway. The stronger piece survives and completes its move. Equal strength removes both.
3. **Same destination.** If both pieces end on the same square, the stronger survives there and the other is removed. Equal strength removes both.
4. **Missed capture.** A capture whose target moved away misses. The moving piece still ends on the square. A pawn that aimed diagonally still ends diagonally.
5. **Normal capture.** A piece that captures a piece which stayed put removes it. A piece that stayed is never "protected" by a move landing elsewhere.
6. Strength: pawn 1, knight 3, bishop 3, rook 5, queen 9, king 100. Collision strength uses the piece as it started the turn, so a promoting pawn clashes as a pawn and promotes only if it survives.
7. **Castling** moves king and rook together. Each piece is checked separately for swaps, collisions and captures. Castling needs an unmoved king and rook and empty squares between them at the start of the turn.
7a. **Kings never trade** (added in balance testing). If both moves are king moves and the kings would land on the same square or swap squares, neither move happens and the turn is spent. The game shows a small bump and a message.
8. **En passant does not exist** in Simultaneous. Pawns may still advance two squares from their starting rank.
9. **Winning.** A side whose king is removed loses. If both kings are removed on the same turn, the game is drawn.
10. **No legal move.** A side with no pseudo-legal move passes. If both sides must pass, the game is drawn.
11. **Draws.** Fifty turns with no capture, collision or pawn move, threefold repetition of the position, both sides reduced to a lone king, or turn 200.

Balance testing may adjust these rules. Any change is recorded in the Balance log below and in the in-game rules panel.

## Computer opponent

All AI runs in a Web Worker so the interface never freezes. Moves are delayed to at least 350 ms so they feel deliberate.
- **Classic.** Negamax alpha-beta with iterative deepening, a transposition table, MVV-LVA capture ordering, killer moves, history heuristic and quiescence search. Evaluation is material plus piece-square tables with a tapered king table, bishop pair, doubled and isolated pawns and mobility lite. Easy searches 1 ply, adds noise of about 80 centipawns and sometimes plays a random reasonable move. Medium searches 3 plies with 20 centipawn noise. Hard uses iterative deepening to depth 6 within a 1.5 second budget.
- **Fog of War.** An honest player. The worker receives only the AI's own observation: its own pieces, the enemy pieces on its visible squares and its own memory of where enemy pieces were last seen. It never receives the true board. It samples several complete boards consistent with the observation, placing unseen enemy pieces near where they were last seen and never on visible squares, then runs a shallow king-capture search on each sample and picks the move with the best average. Easy takes visible captures greedily with randomness. Medium uses 6 samples at depth 2. Hard uses 16 samples at depth 3 with a time limit. A test gives the AI two different true boards with identical observations and confirms it chooses the same move.
- **Simultaneous.** Picks candidate moves for both sides with a fast one-ply score, builds a payoff matrix by resolving every pair and evaluating the result, and optionally looks one more turn ahead on the best cells. Easy picks from its own top moves with noise. Medium plays the move with the best expected value against the opponent's likely replies. Hard solves the matrix for a mixed strategy with regret matching and samples from it, so it is hard to exploit and weighs the worst case.

## Scene and camera
- A warm walnut table with procedural grain, a carved board with a raised frame, inlaid border, engraved file letters and rank numbers, and maple and walnut squares.
- Staunton pieces built from lathe profiles with a mitred bishop, crenellated rook, crowned queen with a ball, cross-topped king and a carved horse-head knight from an extruded profile. Light pieces are boxwood lacquer and dark pieces are ebonised rosewood lacquer, with a clearcoat physical material.
- A warm key light with soft PCF shadows, a cool fill and a hemisphere light. Tone mapping is ACES.
- Orbit by drag or two-finger gesture with limits so the table never flips. A top-down view button and a reset view button. The camera faces the side to move for the human. In pass-and-play it swings to the other side between turns.
- Low quality mode lowers pixel ratio, disables shadows or uses a smaller shadow map and uses simpler materials. It turns on automatically when the frame rate stays under 30 fps for a few seconds or on small low-memory devices.

## Animations
Piece slide with ease-in-out; knight hop on an arc; capture where the victim topples, then slides off to a tray beside the board; castling moves king and rook together; promotion with a glow and piece swap; check as a red pulse ring under the king; checkmate as the losing king toppling and warm light swelling; Fog mist as low drifting planes that fade back from newly visible squares; Simultaneous with both moves at once and collisions that shake, spark and topple the loser; a camera swing in pass-and-play; and menu fades. Reduce animations and `prefers-reduced-motion` shorten moves and remove hops, shakes, camera swings and mist drift.

## Audio
Web Audio synthesis only, off until the player turns it on. No AudioContext is created before the first user gesture that enables sound.
- Effects: wooden clack from filtered noise and a resonant body tone, heavier and lower for heavier pieces; a capture knock followed by a small tumble; a low bell chime for check; a fuller chord for mate; filtered-noise wind as fog rolls back; a soft tense tick while choosing in Simultaneous; a clash made from metallic partials and noise.
- Music: a generative quiet-study piece with soft piano voices and a low string pad. Chord progressions are chosen from a small set per mode with random voicing and rhythm so the music does not loop noticeably. Classic is major and calm. Fog uses Dorian and suspended chords. Simultaneous is minor with a pulsing low string. Intensity rises with material balance closeness and game phase by adding a pulse and brightening the filter.
- Separate music and effects volume sliders and mute toggles, stored in localStorage.

## Interface flow
1. Title screen showing the game name, a slowly orbiting board and buttons for Play, Rules and Settings.
2. New game panel with Mode (Classic, Fog of War, Simultaneous), Opponent (Computer or Pass and play), Difficulty, and colour choice (White, Black, Random).
3. In-game HUD with the mode name, turn indicator, captured pieces, and buttons for Menu, Undo, View (top-down or orbit) and Sound. Simultaneous shows "Choose your move" with a lock-in state and a reveal.
4. A rules panel per mode, reachable from the title screen and in-game.
5. A pass-and-play cover screen that reads "Hand the device to Black" with a tap to continue. It is used in Fog and Simultaneous.
6. A promotion picker showing four piece buttons.
7. A game over screen showing the result, the reason and buttons for Rematch, Change mode and View board.
8. Settings for music and effects volume and mute, reduce animations, graphics quality (Auto, High, Low), and move hints on or off.

Keyboard: arrow keys move a square cursor, Enter selects, Escape cancels or opens the menu, and U undoes.

## Phone layout
Portrait puts the board at the top two thirds and a compact HUD bar at the bottom, with 44 px minimum touch targets. Landscape puts the board on the left and a narrow HUD column on the right. Panels are scrollable sheets. The camera fits the board to the viewport aspect.

## Settings persisted
`chess3w.settings` in localStorage holds music, sfx, musicMuted, sfxMuted, soundEnabled, reduceMotion, quality and hints.

## Balance log
- About 1,400 AI-vs-AI Simultaneous games across random, greedy, king-hunt, turtle and the three AI levels. No strategy always wins and there is no colour advantage.
- Rule 7a added: kings never trade. Before it, walking your king into the enemy king forced a draw from a lost position (12% of games ended with both kings falling).
- The AI now always considers moving its king out of danger, and hard avoids repeating positions.
- Two strong computer players facing each other usually draw by repetition because neither risks an unprotected move. Accepted, since it does not arise against human-style play.
- Fog of War: 336 games, no always-win strategy. A blind king rush scores exactly even.
