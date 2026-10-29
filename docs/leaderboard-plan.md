# Online leaderboard with replay validation: plan

Status: planned 2026-10-20. **Phase 0 done 2026-10-28** (see "Done" below); next: the backend.

## Decided 2026-10-28 (user)

- Hosting: **Vercel** (Hobby: non-commercial, matches the licence) for the API (Node functions that replay the laps with
  `src/sim`) and the public leaderboard website; **Upstash Redis** (Vercel Marketplace) for the boards (sorted sets) and
  the ghosts / replays. GitHub Pages not needed (Vercel serves the site).
- **Top 100 per board**, one entry per player (their best); a board = circuit × active aero on / off × stock car ×
  automatic zones × physics version. Columns: rank, name, time, sectors, assists, gearbox, compound, tyre temperatures,
  setup, controller, date, ghost. A lap outside the top 100 is not kept ("outside the top 100: 100th is …").
- The website: the boards, and a ghost viewer (the lap on a 2D map of the circuit with speed, gear, sectors).
- Submitting from the desktop app first.

## Done (phase 0, 2026-10-28)

- `src/sim/replay.js`: `quantizeInput` (steer 1/4096, pedals 1/1024, before the car uses them), `createReplayRecorder`
  (header = race options + seed + the player's setup / mods / compound; per step the controls as run-length-coded
  deltas; the car's settings recorded when they change: assists, gearbox mode, buttons' modes, BOX, pit plan,
  steering prefs; `taint()` = not replayable: the debug autopilot, pitNow, crash), `replayRun` (every car in race order
  as simStep, collide, laps). The game records from lights out (main.js simStep); `gridlineDebug.replayCheck()` /
  `replayData()`; `node tools/replay-check.mjs file` replays one in Node.
- `src/sim/fmath.js`: sin, cos, tan, atan, atan2, hypot, exp, log, pow from + − × ÷ and sqrt (fdlibm's algorithms);
  the sim uses them (`FM.*`). Before: a 13 s race recorded in the app (Electron, V8 15) replayed in Node 22 (V8 12)
  ended a last bit apart; after: identical, and `npm run sim-trace` gives the same hashes under Node and under
  `ELECTRON_RUN_AS_NODE=1 npx electron tools/sim-trace.mjs` (all 13 traces). AI lap times unchanged (one 0.01 s), the
  sim ~5 % slower. Firefox / Safari not checked yet (the desktop app first).
- Size: ~12 KB a minute gzipped with phone-style analog input (3 min: 35 KB).
- Tests: tests/replay.test.js (bit-identical laps and state with AI traffic and mid-race changes), tests/fmath.test.js. The user's goal: launch the game online and keep everyone's best time trial
laps, so players can race each other's ghosts and see who is fastest.

## The idea in one paragraph

The client does not upload a lap time or a ghost; it uploads **the inputs** it drove with (steering, gas, brake,
shifts per 120 Hz sim step) plus the settings that affect the physics. The server runs the same `src/sim` code in
Node, drives a fresh race with those inputs and reads the lap time off its own result. Only the server's time goes on
the board, and the ghost other players download is made **by the server** from its own replay (the compact
second-difference ghost format from `ghost.js`, ~2–3 KB gzipped). A forged file can't claim a time the physics doesn't
produce.

## What already makes this possible

- `src/sim` is pure (no DOM, runs in Node) and steps at a fixed 120 Hz.
- Every random draw goes through the race's seeded `race.rng` (no `Math.random` in the sim apart from picking a seed):
  same seed + same inputs = same race.
- Time trial = you alone, no wear, no AI: the only inputs are the player's.
- `tools/sim-trace.mjs` already proves bit-identical physics by hashing every car's state each step.
- Ghosts are already small and lossless (`npm run ghost-bench`).

## The big risk: the same physics in every browser

`+ − × ÷` and `Math.sqrt` give bit-identical results everywhere (IEEE 754). **`Math.sin`, `cos`, `tan`, `atan`,
`atan2`, `hypot`, `pow` and `exp` do not**: each JS engine (V8 in Chrome / Electron / Node, SpiderMonkey in Firefox,
JavaScriptCore in Safari) may round them differently in the last bit. Over 7,000+ steps a 1-bit difference can grow
into a different lap. The sim uses them about 65 times today (sin 16, hypot 15, cos 13, atan2 12, tan 5, atan 2, pow 1).

Fix: `src/sim/fmath.js` = deterministic versions of those functions written only with `+ − × ÷` and `sqrt`
(range reduction + fixed polynomials), and the sim uses only those. This changes the sim-trace baseline once (expected;
check lap times stay within a few ms). A test runs the same replay in Node and in the Electron renderer, and CI later
in Firefox and Safari, and compares the hashes.

Fallback if exactness can't be reached: tolerance validation (replayed time within 5 ms and path within 10 cm of the
claim). Exact is much simpler to reason about, so aim for exact.

## Phases

### Phase 0: determinism groundwork (all offline, no server)

1. **Input recorder.** In `simStep`, record exactly what `drivePlayer` gets each step: `steer`, `thr`, `brk`,
   `shift`, `boost`, plus a pit request (BOX). Quantise **before** the car uses them (steer to 1/4096, pedals to 1/1024), so
   the live race and a replay see identical numbers. Analog shaping (`Input.setConfig`: dead zone, curve) happens
   before this point, so it needs no replay. `steerRate`, `calm` and `analog` go in the header.
2. **Replay format** (`src/sim/replay.js`, pure):
   - Header:
     - sim version (a hash of `src/sim`, set at build time);
     - circuit;
     - seed;
     - format (`unlimited`);
     - active aero and overtake;
     - gearbox mode;
     - assists;
     - `calm`;
     - `steerRate`;
     - car spec (setup + mods; ranked boards are stock only).
   - Body: the inputs from lights out to the end of the claimed lap, encoded as run-lengths and deltas, then gzip.
   - Estimate: keyboard laps are tiny (inputs constant for long runs); analog phone laps are maybe 10–30 KB a minute
     (measure: `npm run replay-bench`).
3. **`replayRun(replay)`** (pure): `createRace` + `drivePlayer` per step, returns the lap times, validity (cuts),
   and a ghost of each lap. Test: record a lap in the game, replay it in Node, get the same time to the bit.
4. **fmath.js** (above) + a cross-engine test.
5. **Production build hygiene:**
   - the ranked build has no `gridlineDebug.autopilot`, no `pitNow`, no setters that move the car;
   - the debug object only exists in dev builds.

Why replay from lights out and not just the lap: the car's state at the line (speed, gear, position, dirty tyres,
wing flaps open) comes from the laps before. A snapshot of that state could be forged; replaying from lights out
can't. Cost: the sim runs about 2,000× real time in Node, so even a 30-minute session is under a second of server CPU.

### Phase 1: backend (minimal)

- **Endpoints:**
  - `POST /runs` (auth; gzipped replay, ≤ 512 KB) → queued.
  - `GET /boards/:circuit?aero=on` → the top 100, plus the 10 times around yours.
  - `GET /laps/:id/ghost` → the server-made compact ghost (cacheable forever).
  - `GET /me` → your runs and their status.
- **Worker:**
  - pulls the queue and runs `replayRun` with the sim version named in the header (keeps old builds of `src/sim`
    around per version);
  - keeps the best valid lap;
  - stores the time and the ghost;
  - marks the run verified, or rejected with the reason (didn't finish a lap, cut, the time didn't match the client's
    claim, unknown sim version).
- **Storage:**
  - rows: player, circuit, class, aero, sim version, time, status, date;
  - blobs (replay, ghost): an object store;
  - a replay is ~10–100 KB, a ghost ~3 KB.
- **Hosting** (decide later):
  - Cloudflare Workers + D1 + R2: cheap, no server to run, but the worker CPU limits need checking for long replays;
  - or one small Node VPS + SQLite / Postgres: the simplest to start with.
- **Accounts:**
  - start with a display name + a device key (anonymous, low friction), then email magic links or OAuth;
  - Steam later if the game ships there.
  - Rate limits per account and per IP.
  - Display names go through a word filter.

### Phase 2: in the game

- **Submitting:** after a clean lap in a time trial with the stock car, offer to submit it, or submit
  automatically (setting). The HUD / start menu shows the status: pending → verified #12, or rejected with the reason.
- **Leaderboard screen** (start menu): per circuit, filter by aero on / off and by assists; your position; "race this
  ghost" downloads the ghost into the existing ghost list (a new "Online" entry beside Your best / Loaded / AI levels).
- **Offline play** stays exactly as now. Submissions made offline wait in a queue and go when online.

### Phase 3: hardening

- **What replay cannot catch:** a lap that is physically possible but not driven by a human (a bot, or inputs
  optimised offline, i.e. a tool-assisted lap). The game's own AI could drive one.
  - Remove that from release builds (Phase 0).
  - Heuristics flag suspicious runs for review: input timing too regular, steering without human noise, near-
    perfect laps on the first attempt.
  - Top-10 laps per board get a manual look.
  - This can only be made hard, not impossible; state it in the rules.
- **Physics changes:** a change to `src/sim` changes the sim version. Boards are per version ("season"): old laps are
  kept in an archive board, or re-replayed with the new physics where the inputs still make a clean lap. The game shows
  the season.
- **Modified cars:** a separate unranked board, or none.

## Decisions for the user (later)

1. Hosting: serverless (Cloudflare) or a small VPS?
2. Accounts: anonymous device key first, or sign-in from day one?
3. Separate boards per assist level, or one board with assist icons next to each time?
4. Active aero on and off: two boards, or only the default?
5. Ranked laps from the browser version too, or only the desktop app?

## Order of work when this starts

Phase 0 steps 1–3 first (an input recorder, replay format and Node replay of your own lap, all testable offline), then
fmath.js and the cross-browser check, because if exact cross-browser replay can't be had, the validation design
changes to tolerance before any server code is written.
