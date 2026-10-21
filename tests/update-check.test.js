// The start menu's "new version" check (desktop/update-check.cjs): version order, which releases count, safe links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { compare, newestRelease, checkForUpdate, isReleaseUrl } = createRequire(import.meta.url)('../desktop/update-check.cjs');
const rel = (tag, o = {}) => ({ tag_name: tag, html_url: `https://github.com/EmmanuelAbebe/gridline-gp/releases/tag/${tag}`, name: tag, draft: false, prerelease: tag.includes('-'), ...o });

test('versions sort like semver: alpha < alpha.1 < alpha.2 < beta < the release', () => {
  const order = ['0.1.0-alpha', '0.1.0-alpha.1', '0.1.0-alpha.2', '0.1.0-alpha.10', '0.1.0-beta', '0.1.0-beta.1', '0.1.0', '0.1.1', '0.2.0', '1.0.0'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(compare(order[i + 1], order[i]), 1, `${order[i + 1]} > ${order[i]}`);
    assert.equal(compare(order[i], order[i + 1]), -1);
  }
  assert.equal(compare('v0.1.0-alpha.1', '0.1.0-alpha.1'), 0);
  assert.equal(compare('nonsense', '0.1.0'), 0);
});

test('the newest newer release; drafts never; pre-releases only for alpha / beta players', () => {
  const list = [rel('v0.1.0-alpha.1'), rel('v0.1.0-alpha.3'), rel('v0.1.0-alpha.2'), rel('v0.2.0-alpha.1', { draft: true }), rel('junk')];
  assert.equal(newestRelease(list, '0.1.0-alpha.1').version, '0.1.0-alpha.3');
  assert.match(newestRelease(list, '0.1.0-alpha.1').url, /releases\/tag\/v0\.1\.0-alpha\.3$/);
  assert.equal(newestRelease(list, '0.1.0-alpha.3'), null, 'up to date');
  assert.equal(newestRelease([rel('v0.2.0-beta.1'), rel('v0.1.1')], '0.1.0').version, '0.1.1', 'a full release ignores betas');
  assert.equal(newestRelease(null, '0.1.0'), null);
});

test('checkForUpdate asks GitHub once and reports a failure', async () => {
  let asked = 0;
  const ok = async url => { asked++; assert.match(url, /api\.github\.com\/repos\/EmmanuelAbebe\/gridline-gp\/releases/); return { ok: true, json: async () => [rel('v0.1.0-alpha.2')] }; };
  assert.equal((await checkForUpdate('0.1.0-alpha.1', ok)).version, '0.1.0-alpha.2');
  assert.equal(asked, 1);
  await assert.rejects(checkForUpdate('0.1.0-alpha.1', async () => ({ ok: false, status: 403 })), /403/);
});

test('only this game\'s releases pages may be opened', () => {
  assert.ok(isReleaseUrl('https://github.com/EmmanuelAbebe/gridline-gp/releases'));
  assert.ok(isReleaseUrl('https://github.com/EmmanuelAbebe/gridline-gp/releases/tag/v0.1.0-alpha.2'));
  for (const u of ['https://evil.example/', 'https://github.com/EmmanuelAbebe/gridline-gp/releasesX', 'file:///etc/passwd', null]) assert.ok(!isReleaseUrl(u), String(u));
});
