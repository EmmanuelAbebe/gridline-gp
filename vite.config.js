// Build: everything (game code, Three.js, CSS, fonts) is inlined into one self-contained dist/index.html that runs
// from file://, in the Electron app, or served over http. public/ (manifest, icons, service worker) is copied as is.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  assetsInclude: ['**/*.glb'],     // Blender models (src/game/models): data: URLs too
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: Infinity,   // fonts become data: URLs
    reportCompressedSize: false,
  },
  server: { port: 5173, strictPort: true },
});
