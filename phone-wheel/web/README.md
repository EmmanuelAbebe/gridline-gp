# Phone Wheel page (React + TypeScript)

The page the phone opens: tilt steering, pedals, buttons, settings. Built with Vite into `web/dist`, which the game's
phone server (`desktop/phone-link.cjs`) and `server.py` serve at `/`.

## Changing how it looks
- **`src/theme.css`**: every colour, font, size, radius and spacing. Start here: change a variable, everything follows.
- **`src/base.css`**: buttons and rows shared by all screens.
- Each part of the screen is one component with its CSS next to it:

  | Screen part | Files |
  |---|---|
  | start screen | `ui/StartScreen.tsx` / `.css` |
  | driving screen layout (brake · upshift · middle · downshift · gas, status along the bottom) | `ui/Drive.tsx` / `.css` (column widths `--pedal-fr` `--shift-fr` `--center-fr` in theme.css) |
  | pedals (a face sinking into its base, `--pedal-depth`) | `ui/Pedal.tsx` / `.css` |
  | UPSHIFT / DOWNSHIFT keys | `ui/ShiftButton.tsx` / `.css` |
  | middle column (Settings, wheel = tap to centre, extra buttons, Reconnect) | `ui/Center.tsx` (in `Drive.css`), `ui/Wheel.tsx` (the SVG) |
  | status line (connection, link quality, full screen) | `ui/StatusLine.tsx` / `.css` (icons: `react-icons/ri`, size `--icon-size`) |
  | on-screen buttons | `ui/AuxButton.tsx` / `.css` |
  | "turn sideways" prompt | `ui/RotateHint.tsx` |
  | settings (tabs, rows, sliders) | `ui/settings/*` (`controls.tsx` = the row building blocks, `Settings.css`) |

- Don't put input logic in components: steering, pedals and the 60 Hz feed to the PC live in `src/engine/engine.ts`
  (outside React, so rendering never delays an input). Components read `engine.state` in `useFrame` and write pedals /
  buttons. Settings and their limits: `src/settings/settings.ts`.
- Force feedback (the game's vibration): the rhythm of each effect (kerb ripple, gravel rumble, slide buzz, hit length)
  is the `FFB` table in `src/engine/haptics.ts`; Settings → Feedback has test buttons to feel a change at once.
- Icons: any of https://react-icons.github.io/react-icons/icons/ri/ (`import { RiSomethingFill } from 'react-icons/ri'`);
  other sets in react-icons work the same way.

## Workflow (from the repo root)
1. **On the PC, with hot reload**: `npm run phone:dev`, open http://localhost:5180. The mouse across the window (or
   ← →, Space = centre) stands in for the phone's tilt. To drive the game from the preview: start the game, Connect
   phone, then `PHONE_WHEEL_SERVER=https://127.0.0.1:8443 npm run phone:dev` and open
   `http://localhost:5180/?t=<pairing code from the QR link>`.
2. **On the phone**: `npm run phone:watch` (rebuilds on every save), connect the phone as usual and reload its page.
3. Before committing: `npm run check` (types, tests, both builds).
