// Loads the SIM API for the Node tools, either from the source modules (default) or from an old single-file
// build (any .html with /*SIM-START*/ … /*SIM-END*/ markers, e.g. `git show <rev>:gridline.html > old.html`).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function loadSim(source) {
  if (source && source.endsWith('.html')) {
    const html = readFileSync(source, 'utf8');
    const a = html.indexOf('/*SIM-START*/'), b = html.indexOf('/*SIM-END*/');
    if (a < 0 || b < 0) throw new Error(`SIM markers not found in ${source}`);
    return new Function(html.slice(a, b) + '\nreturn SIM;')();
  }
  const file = source || new URL('../src/sim/index.js', import.meta.url).pathname;
  return (await import(pathToFileURL(path.resolve(file)).href)).SIM;
}
