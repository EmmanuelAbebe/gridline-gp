# Credits

Third-party work in Gridline GP, with the credit its licence asks for.

## The 2026 car

This work is based on "F1 2026 concept (polygon model)"
(https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42) by Qvist_designs
(https://sketchfab.com/Qvist_Designs) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

Changes made for the game (tools/blender/qvist.py): turned into the game's frame and scale, cut down from about
1 million to about 60,000 triangles, split into the parts the game moves (wheels, wing flaps), painted with the game's
own colours and liveries, given brake lights, a helmet, a steering wheel and the driver's anchor points. The game's
own licence (LICENSE) does not cover this model: it stays under CC-BY-4.0.

## The driver, helmet and steering wheel (2026 car)

The driver is based on "race driver" (https://sketchfab.com/3d-models/race-driver-e4e97df9865d466c8359fbb23e757308)
by BELAZ (https://sketchfab.com/asset_for_games) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
The figure is a Ready Player Me avatar (https://readyplayer.me); Ready Player Me avatars are offered under CC BY-NC-SA
4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/), so the adapted driver is shared under those terms too:
non-commercial use, credit, and changes shared under the same licence.

The helmet is based on "Racing helmet" (https://sketchfab.com/3d-models/racing-helmet-b92c1426837e47778db2487f2c2d7121)
by MizuCorp (https://sketchfab.com/mizucorp4) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

The steering wheel is based on "Steering-Wheel type Formula"
(https://sketchfab.com/3d-models/steering-wheel-type-formula-9a6207a32d1f4fa4b6ded33181a9edd1) by
OscarContrerasLithgow (https://sketchfab.com/Vistra-) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

Changes made for the game (tools/blender/cockpit.py → src/game/models/driver.glb): the driver scaled to 1.76 m, seated
and posed in the car (reclined, arms slimmed, hands on the wheel at nine steering angles, black gloves, the head
replaced by the helmet), the helmet's visor closed and tinted, the helmet and wheel cut down in triangles, textures made
smaller. The game's own licence (LICENSE) does not cover these models: they stay under their own licences.

## The steering assist for phones and pads

`src/sim/steer-assist.js` (and its presets, `STEER_ASSIST` in `src/sim/tuning.js`) is adapted from
`src/lib/sim/steering-assist.ts` of LibreCorsa (https://github.com/KhazP/librecorsa), which is itself adapted from
AC-Advanced-Gamepad-Assist v1.5.5 (https://github.com/adam10603/AC-Advanced-Gamepad-Assist) by Adam D. Both are under
the MIT License. Changes made for the game: rewritten in this project's JavaScript and sign conventions on its own car
model and deterministic maths, without the stick smoother, the keyboard parts or the peak-slip learning; three presets.

> Copyright (c) 2026 KhazP
>
> Copyright (c) 2023 Adam D.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
> persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
> Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
> WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
