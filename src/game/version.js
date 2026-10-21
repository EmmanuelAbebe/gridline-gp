// The game's version (package.json "version"; Vite keeps only this field of the JSON) and its stage label for the
// start menu: "0.1.0-alpha.1" → "ALPHA 0.1.0".
export { version as VERSION } from '../../package.json';
export const stageLabel = v => { const m = /^(\d+\.\d+\.\d+)(?:-([a-z]+))?/i.exec(v) || []; return m[2] ? `${m[2].toUpperCase()} ${m[1]}` : m[1] ? `v${m[1]}` : ''; };
