import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDevServer } from '../scripts/dev.mjs';

async function fixture(t, { symlinkRoot = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hustle-cards-http-'));
  const portraits = path.join(directory, 'assets/legendary');
  await mkdir(portraits, { recursive: true });
  const image = Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary');
  const filename = path.join(portraits, 'sample-v1.webp');
  await Promise.all([
    writeFile(filename, image),
    writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Cards</title>'),
    writeFile(path.join(directory, 'app.js'), 'globalThis.ready = true;'),
  ]);
  const root = symlinkRoot ? `${directory}-linked` : directory;
  if (symlinkRoot) await symlink(directory, root, 'dir');
  const server = createDevServer(root);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    if (symlinkRoot) await rm(root, { force: true });
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { image, filename, directory, request: (pathname = '/assets/legendary/sample-v1.webp', options) => fetch(`${origin}${pathname}`, options) };
}

test('portrait responses use WebP MIME type, unchanged binary data and normal HTTP cache validators', async (t) => {
  const app = await fixture(t);
  const response = await app.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('etag'), /^"[a-f0-9]{64}"$/);
  assert.ok(Number.isFinite(Date.parse(response.headers.get('last-modified'))));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), app.image);
});

test('portrait conditional requests return 304 and If-None-Match takes precedence over dates', async (t) => {
  const app = await fixture(t);
  const original = await app.request();
  const etag = original.headers.get('etag');
  const modified = original.headers.get('last-modified');
  await original.arrayBuffer();
  for (const headers of [
    { 'If-None-Match': etag },
    { 'If-None-Match': `"another-image", W/${etag}` },
    { 'If-None-Match': '*' },
    { 'If-Modified-Since': modified },
  ]) {
    const response = await app.request(undefined, { headers });
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('etag'), etag);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  }
  const changed = await app.request(undefined, { headers: { 'If-None-Match': '"different"', 'If-Modified-Since': modified } });
  assert.equal(changed.status, 200);
  await changed.arrayBuffer();
});

test('changed portrait bytes invalidate the ETag even when the filename and byte length stay the same', async (t) => {
  const app = await fixture(t);
  const original = await app.request();
  const etag = original.headers.get('etag');
  await original.arrayBuffer();
  const changed = Buffer.from(app.image);
  changed[4] = 5;
  await writeFile(app.filename, changed);
  const response = await app.request(undefined, { headers: { 'If-None-Match': etag } });
  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get('etag'), etag);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), changed);
});

test('portrait HEAD requests send headers without an image body, while code and missing images remain uncached', async (t) => {
  const app = await fixture(t);
  const head = await app.request(undefined, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'image/webp');
  assert.equal(Number(head.headers.get('content-length')), app.image.length);
  assert.equal(await head.text(), '');
  for (const [pathname, status] of [['/', 200], ['/app.js', 200], ['/assets/legendary/missing.webp', 404]]) {
    const response = await app.request(pathname);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.arrayBuffer();
  }
  const post = await app.request(undefined, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal(post.headers.get('cache-control'), 'no-store');
  await post.text();
});

test('a symlinked server root works, while child symlinks outside that root remain inaccessible', async (t) => {
  const app = await fixture(t, { symlinkRoot: true });
  const response = await app.request();
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), app.image);
  const index = await app.request('/');
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Cards/);

  const outside = await mkdtemp(path.join(os.tmpdir(), 'hustle-cards-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const secret = path.join(outside, 'private.webp');
  await writeFile(secret, 'outside the static root');
  await symlink(secret, path.join(app.directory, 'assets/legendary/escape-v1.webp'));
  const escaped = await app.request('/assets/legendary/escape-v1.webp');
  assert.equal(escaped.status, 400);
  assert.equal(escaped.headers.get('cache-control'), 'no-store');
  assert.equal(await escaped.text(), 'Invalid path');
});

test('portraits hosted below a deployment subpath retain MIME type and HTTP caching', async (t) => {
  const app = await fixture(t);
  const nested = path.join(app.directory, 'subpath/hustlecards/assets/legendary');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'sample-v1.webp'), app.image);
  const pathname = '/subpath/hustlecards/assets/legendary/sample-v1.webp';
  const response = await app.request(pathname);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  const etag = response.headers.get('etag');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), app.image);
  const cached = await app.request(pathname, { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(await cached.text(), '');
});
