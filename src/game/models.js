import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import treesGlb from './models/trees.glb?url';
import pitsGlb from './models/pits.glb?url';
import standsGlb from './models/stands.glb?url';

// Models made in Blender (tools/blender/*.py, `npm run models`), packed into the page as data URLs and loaded once at
// boot (`await loadModels()` before the first world is built). Only geometry and textures are taken from the files:
// the game makes its own materials (Lambert, like the rest of the world; no colour-space conversion, as the renderer
// has none).
//   Models.trees = { cone: [variant], ball: [variant] } (the themes' tree kinds, config.js THEMES), variant =
//   { name, bark, leaves } geometries (origin at the foot of the trunk, m), and Models.treeMaps = { bark, leaves } textures.
//   Models.pits = { bay, end_a, end_b, stand: { [role]: geometry } } (tools/blender/pits.py: in the frame world.js places
//   them in, x along the track, y up, z away from it; roles solid / team / glass / clear / light / panel).
//   Models.stands = { main, small, <kind>_end_a / _end_b, fan_sit, fan_cheer: { [role]: geometry } } (stands.py; a bay's
//   geometries carry its seat layout in userData, from the glTF extras).
export const Models = { trees: null, treeMaps: null, pits: null, stands: null };

const KIND = { spruce: 'cone', broad: 'ball' };   // the .glb's tree names (spruce_a ...) → theme kinds

async function parse(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  return new Promise((ok, fail) => new GLTFLoader().parse(buf, '', ok, fail));
}

export async function loadModels() {
  const gltf = await parse(treesGlb), parts = {}, maps = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const [name, part] = o.name.split('-'), g = o.geometry.clone().applyMatrix4(o.matrixWorld);   // (Blender Z up → Y up; '.' would be dropped from the names)
    (parts[name] ||= { name })[part] = g;
    const map = o.material.map; if (map) { map.encoding = THREE.LinearEncoding; maps[part] = map; }
  });
  const trees = { cone: [], ball: [] };
  for (const v of Object.values(parts)) {
    const kind = KIND[v.name.split('_')[0]];
    if (!kind || !v.bark || !v.leaves) throw new Error(`trees.glb: unexpected model ${v.name} (run npm run models)`);
    trees[kind].push(v);
  }
  for (const list of Object.values(trees)) list.sort((a, b) => a.name.localeCompare(b.name));
  coverageMips(maps.leaves, LEAF_CUT);
  Models.trees = trees; Models.treeMaps = maps;
  Models.pits = modules(await parse(pitsGlb));
  Models.stands = modules(await parse(standsGlb));
}

// a file of building modules: objects named `<module>-<role>` → { [module]: { [role]: geometry } }
function modules(gltf) {
  const out = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const [mod, role] = o.name.split('-');
    const g = (out[mod] ||= {})[role] = o.geometry.clone().applyMatrix4(o.matrixWorld);
    g.userData = { ...o.userData };                                    // (glTF extras)
  });
  return out;
}

export const LEAF_CUT = 0.4;   // the leaves' alphaTest

// Mipmaps for an alpha-tested texture that keep its coverage: ordinary ones average thin needles and leaf edges below
// the cut, so trees went bare in the distance. Each level is a 2×2 box filter (colour weighted by alpha), its alpha then
// scaled until the same share of pixels passes `cut` as in the full-size image. Transparent pixels take the mean colour
// (no dark fringe where the filtering reaches them).
function coverageMips(texture, cut) {
  const img = texture.image, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  let cur = g.getImageData(0, 0, cv.width, cv.height);
  const mean = [0, 0, 0]; let wsum = 0;
  for (let p = 0, d = cur.data; p < d.length; p += 4) { const a = d[p + 3]; mean[0] += d[p] * a; mean[1] += d[p + 1] * a; mean[2] += d[p + 2] * a; wsum += a; }
  for (let c = 0; c < 3; c++) mean[c] /= Math.max(wsum, 1);
  const fill = d => { for (let p = 0; p < d.length; p += 4) if (d[p + 3] < 4) { d[p] = mean[0]; d[p + 1] = mean[1]; d[p + 2] = mean[2]; } };
  const T = cut * 255, cover = (d, s) => { let n = 0; for (let p = 3; p < d.length; p += 4) if (d[p] * s > T) n++; return n / (d.length / 4); };
  fill(cur.data);
  const target = cover(cur.data, 1), mips = [cur];
  while (cur.width > 1 || cur.height > 1) {
    const w = Math.max(1, cur.width >> 1), h = Math.max(1, cur.height >> 1), next = new ImageData(w, h), s = cur.data, d = next.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const sx = Math.min(cur.width - 1, 2 * x + dx), sy = Math.min(cur.height - 1, 2 * y + dy), p = (sy * cur.width + sx) * 4, al = s[p + 3];
        r += s[p] * al; gg += s[p + 1] * al; b += s[p + 2] * al; a += al;
      }
      const q = (y * w + x) * 4;
      if (a > 0) { d[q] = r / a; d[q + 1] = gg / a; d[q + 2] = b / a; } d[q + 3] = a / 4;
    }
    let lo = 1, hi = 8;                                // the alpha scale that gives the same coverage
    for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (cover(d, m) < target) lo = m; else hi = m; }
    for (let p = 3; p < d.length; p += 4) d[p] = Math.min(255, d[p] * hi);
    fill(d); mips.push(next); cur = next;
  }
  texture.mipmaps = mips; texture.generateMipmaps = false; texture.needsUpdate = true;
}
