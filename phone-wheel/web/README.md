# Phone Wheel page (React + TypeScript)

The page the phone opens: tilt steering, pedals, buttons, settings. Built with Vite into `web/dist`, which the game's
phone server (`desktop/phone-link.cjs`) and `server.py` serve at `/` (the previous page is still at `/v1`).

## Changing how it looks
- **`src/theme.css`**: every colour, font, size, radius and spacing. Start here: change a variable, everything follows.
- **`src/base.css`**: buttons and rows shared by all screens.
- Each part of the screen is one component with its CSS next to it:

  | Screen part | Files |
  |---|---|
  | start screen | `ui/StartScreen.tsx` / `.css` |
  | driving screen layout | `ui/Drive.tsx` / `.css` |
  | pedals | `ui/Pedal.tsx` / `.css` |
  | middle column (wheel, readout, Center, quick sliders) | `ui/Center.tsx`, `ui/Wheel.tsx` (the SVG) |
  | status bar (connection, link quality, ↻ reconnect, ⛶ full screen, Settings) | `ui/StatusBar.tsx` / `.css` |
  | on-screen buttons | `ui/AuxButton.tsx` / `.css` |
  | "turn sideways" prompt | `ui/RotateHint.tsx` |
  | settings (tabs, rows, sliders) | `ui/settings/*` (`controls.tsx` = the row building blocks, `Settings.css`) |

- Don't put input logic in components: steering, pedals and the 60 Hz feed to the PC live in `src/engine/engine.ts`
  (outside React, so rendering never delays an input). Components read `engine.state` in `useFrame` and write pedals /
  buttons. Settings and their limits: `src/settings/settings.ts`.

## Workflow (from the repo root)
1. **On the PC, with hot reload**: `npm run phone:dev`, open http://localhost:5180. The mouse across the window (or
   ← →, Space = centre) stands in for the phone's tilt. To drive the game from the preview: start the game, Connect
   phone, then `PHONE_WHEEL_SERVER=https://127.0.0.1:8443 npm run phone:dev` and open
   `http://localhost:5180/?t=<pairing code from the QR link>`.
2. **On the phone**: `npm run phone:watch` (rebuilds on every save), connect the phone as usual and reload its page.
3. Before committing: `npm run check` (types, tests, both builds).
