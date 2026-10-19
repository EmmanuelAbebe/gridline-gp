// The phone page (React + TypeScript). From the repo root:
//   npm run phone:dev    desktop preview with hot reload: http://localhost:5180 (fake tilt from the mouse / arrow keys)
//   npm run phone:build  → phone-wheel/web/dist, which the game's phone server and phonewheel/webapp.py serve at /
// PHONE_WHEEL_SERVER=https://127.0.0.1:8443 (the game's server, or server.py) makes the dev server forward /ws and
// /check to it, so the preview can drive the game for real.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.PHONE_WHEEL_SERVER;
export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5180, host: true,
    proxy: target ? { '/ws': { target, ws: true, secure: false }, '/check': { target, secure: false } } : undefined,
  },
});
