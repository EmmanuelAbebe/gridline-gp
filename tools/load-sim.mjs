// Loads the SIM API for the Node tools: the source modules (default) or another copy of src/sim/index.js (e.g. a
// checkout of an older commit, to compare sim-trace hashes). (Loading the pre-module single-file gridline.html was
// dropped 2026-10-21: its physics is long gone, so there is nothing left to compare it with.)
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function loadSim(source) {
  const file = source || new URL('../src/sim/index.js', import.meta.url).pathname;
  return (await import(pathToFileURL(path.resolve(file)).href)).SIM;
}
