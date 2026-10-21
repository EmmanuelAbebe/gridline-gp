// "A new version is out": the start menu asks once per start (Settings → Tools → Check for updates, pref updateCheck)
// and shows the newest release on GitHub with a DOWNLOAD button that opens its page. Nothing is installed by itself and
// nothing about the player is sent: one unauthenticated GET of the public releases list. Alpha / beta versions see
// pre-releases too; a full release only sees full releases.
const RELEASES = 'https://github.com/EmmanuelAbebe/gridline-gp/releases';
const API = 'https://api.github.com/repos/EmmanuelAbebe/gridline-gp/releases?per_page=20';

// "v0.1.0-alpha.2" → { core: [0, 1, 0], pre: ['alpha', 2] } (null if it isn't a version)
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim());
  if (!m) return null;
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.').map(p => /^\d+$/.test(p) ? +p : p) : [] };
}
// semver order: a > b → 1, a < b → -1, same → 0 (1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0)
function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p !== typeof q) return typeof p === 'number' ? -1 : 1;
    return p > q ? 1 : -1;
  }
  return 0;
}
// the newest release in the API's list that is newer than `current` → { version, url, name } | null
function newestRelease(list, current) {
  const pre = parse(current)?.pre.length > 0;
  let best = null;
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.draft || (r.prerelease && !pre) || !parse(r.tag_name)) continue;
    if (compare(r.tag_name, current) > 0 && (!best || compare(r.tag_name, best.tag_name) > 0)) best = r;
  }
  return best && { version: best.tag_name.replace(/^v/, ''), url: String(best.html_url || RELEASES), name: best.name || best.tag_name };
}
async function checkForUpdate(current, fetchFn = fetch) {
  const res = await fetchFn(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Gridline-GP' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return newestRelease(await res.json(), current);
}
// only links to this game's releases page may be opened from the page
const isReleaseUrl = url => typeof url === 'string' && (url === RELEASES || url.startsWith(RELEASES + '/'));

module.exports = { compare, newestRelease, checkForUpdate, isReleaseUrl, RELEASES };
