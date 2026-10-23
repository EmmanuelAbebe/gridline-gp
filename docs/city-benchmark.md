# City benchmark: big textures and big meshes

Cobalt Bay's city is on hold in the game (2026-10-23); its buildings were made only to measure what large textures and
meshes cost. Run it with `npm run bench:city` (needs Blender): `tools/blender/city.py` makes six building types at four
facade texture sizes and three mesh levels, `desktop/main.cjs --bench-city` scatters each set round Cobalt Bay
(`src/game/bench.js`, instanced per type, sun shadows on) and times three views. `GRIDLINE_BENCH_COUNTS` sets the
building counts (default 260,1000; only 904 fit round the circuit).

- **texture** = one facade texture per building type (six), RGBA + mipmaps in GPU memory; each side of a building is
  mapped once (no tiling).
- **mesh**: `low` flat walls (windows painted), `mid` every window recessed (~9 quads a window), `high` + frames and sills
  (~24 quads a window).
- **ms** = one frame of that view, the shadow pass and the GPU included (`gridlineDebug.renderMs`); the circuit alone
  (row `none`) already has ~1.1 M triangles.

Results: 2026-10-23, Ryzen 5 5600 + Radeon RX 9060 XT (Mesa RADV), Electron offscreen, 1280×720, Quality mode.

| set | buildings | triangles | texture MB | file MB | parse ms | upload ms | street ms | side ms | aerial ms | draw calls |
|---|---|---|---|---|---|---|---|---|---|---|
| none | 0 | 0.00 M | 0 | 0 | - | - | 1.27 | 1.47 | 2.61 | 567 |
| t512-low | 260 | 0.01 M | 8 | 0.3 | 11 | 50 | 1.45 | 1.59 | 2.64 | 579 |
| t512-low | 904 | 0.03 M | 8 | 0.3 | 35 | 42 | 1.54 | 1.62 | 2.82 | 579 |
| t1024-low | 260 | 0.01 M | 32 | 0.7 | 28 | 57 | 1.42 | 1.59 | 2.69 | 579 |
| t1024-low | 904 | 0.03 M | 32 | 0.7 | 27 | 57 | 1.5 | 1.7 | 2.78 | 579 |
| t2048-low | 260 | 0.01 M | 128 | 2.2 | 85 | 127 | 1.43 | 1.66 | 2.61 | 579 |
| t2048-low | 904 | 0.03 M | 128 | 2.2 | 83 | 129 | 1.55 | 1.72 | 2.84 | 579 |
| t4096-low | 260 | 0.01 M | 512 | 6.5 | 320 | 393 | 1.4 | 1.65 | 2.68 | 579 |
| t4096-low | 904 | 0.03 M | 512 | 6.5 | 316 | 388 | 1.5 | 1.7 | 2.96 | 579 |
| t512-mid | 260 | 2.39 M | 8 | 4.7 | 18 | 55 | 2.4 | 2.63 | 3.65 | 579 |
| t512-mid | 904 | 8.31 M | 8 | 4.7 | 17 | 57 | 3.81 | 4.1 | 6.19 | 579 |
| t1024-mid | 260 | 2.39 M | 32 | 5.2 | 64 | 71 | 2.74 | 2.6 | 3.81 | 579 |
| t1024-mid | 904 | 8.31 M | 32 | 5.2 | 34 | 74 | 3.61 | 4.04 | 6.27 | 579 |
| t2048-mid | 260 | 2.39 M | 128 | 6.6 | 86 | 140 | 2.34 | 2.61 | 3.7 | 579 |
| t2048-mid | 904 | 8.31 M | 128 | 6.6 | 85 | 141 | 3.59 | 4.31 | 6.36 | 579 |
| t4096-mid | 260 | 2.39 M | 512 | 11 | 324 | 372 | 2.36 | 2.59 | 3.68 | 579 |
| t4096-mid | 904 | 8.31 M | 512 | 11 | 318 | 378 | 3.7 | 4.75 | 6.6 | 579 |
| t512-high | 260 | 7.67 M | 8 | 14.9 | 27 | 59 | 3.65 | 3.87 | 5.96 | 579 |
| t512-high | 904 | 26.72 M | 8 | 14.9 | 28 | 64 | 6.92 | 7.4 | 9.05 | 579 |
| t1024-high | 260 | 7.67 M | 32 | 15.4 | 42 | 74 | 3.6 | 4.16 | 5.74 | 579 |
| t1024-high | 904 | 26.72 M | 32 | 15.4 | 41 | 75 | 6.66 | 7 | 9.03 | 579 |
| t2048-high | 260 | 7.67 M | 128 | 16.8 | 100 | 150 | 3.72 | 4.23 | 5.69 | 579 |
| t2048-high | 904 | 26.72 M | 128 | 16.8 | 94 | 154 | 6.92 | 7.02 | 9.08 | 579 |
| t4096-high | 260 | 7.67 M | 512 | 21.2 | 330 | 379 | 3.59 | 3.83 | 5.73 | 579 |
| t4096-high | 904 | 26.72 M | 512 | 21.2 | 322 | 391 | 6.98 | 7.35 | 8.94 | 579 |

## What it says

- **Texture size costs loading, not frame time.** From 8 MB to 512 MB of textures the frame time stays the same on this
  GPU (16 GB). A 4096 px facade costs ~55 ms to decode and ~65 ms to upload per texture, the file grows (JPEG), and the
  memory matters on a GPU with little of its own (the old Intel HD 520 shares 8 GB with everything else).
  Facades of 1024–2048 px are plenty: at 2048 a 22 m facade gets ~1 cm per pixel.
- **Triangles cost frame time, about linearly:** ~0.21 ms per million in the street view (with the shadow pass),
  ~0.24 ms per million from the air. 27 M triangles still ran at ~9 ms (110 fps) here; a weak GPU would be 10–20×
  slower, so detail like modelled window frames needs levels of detail (near buildings only) before it goes in a game.
- **Draw calls don't grow** with the building count: one instanced mesh per type and role.
