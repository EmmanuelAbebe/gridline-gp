// Lint: catches undeclared and unused names across the modules (`npm run lint`).
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-import-assign': 'error',
  'no-self-assign': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};
export default [
  { ignores: ['dist/', 'node_modules/', 'backup/', 'leaderboard/node_modules/'] },
  { files: ['src/sim/**/*.js'], languageOptions: { globals: {} }, rules },                     // the sim must not touch the browser
  { files: ['src/game/**/*.js', 'public/**/*.js'], languageOptions: { globals: { ...globals.browser } }, rules },
  { files: ['tools/**/*.mjs', 'tests/**/*.js', '*.config.js'], languageOptions: { globals: { ...globals.node } }, rules },
  // the online leaderboard (leaderboard/): Vercel functions + tools in Node, the website in the browser
  { files: ['leaderboard/api/**/*.js', 'leaderboard/lib/**/*.js', 'leaderboard/*.mjs'], languageOptions: { globals: { ...globals.node } }, rules },
  { files: ['leaderboard/public/**/*.js'], languageOptions: { globals: { ...globals.browser } }, rules },
  { files: ['desktop/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }, rules },
];
