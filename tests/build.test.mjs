import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Fixtures live outside the checkout, but use the installed project dependency.
const minifier = import.meta.resolve('html-minifier-terser');
const builder = (await readFile(path.join(project, 'scripts/build.mjs'), 'utf8'))
  .replace("'html-minifier-terser'", JSON.stringify(minifier));
const portraitEntry = '<script src="./portraits.js" defer></script>';
const appEntry = '<script src="./app.js" defer></script>';
const template = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"></head><body><main>Hustle Cards</main>${portraitEntry}${appEntry}</body></html>`;
// Synthetic RIFF/WebP bytes exercise the copier without shipping a portrait.
const webp = Buffer.from([82, 73, 70, 70, 16, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 4, 0, 0, 0, 47, 0, 0, 0]);

async function fixture(t, { html = template, css = 'body { color: #fff; }', js = 'globalThis.ready = true;', portraits = '', assets = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hustle-cards-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all(['src', 'scripts', 'dist'].map((name) => mkdir(path.join(directory, name))));
  await Promise.all([
    writeFile(path.join(directory, 'scripts/build.mjs'), builder),
    writeFile(path.join(directory, 'src/index.html'), html),
    writeFile(path.join(directory, 'src/styles.css'), css),
    writeFile(path.join(directory, 'src/app.js'), js),
    writeFile(path.join(directory, 'src/portraits.js'), portraits),
  ]);
  const assetDirectory = path.join(directory, 'src/assets/legendary');
  if (Object.keys(assets).length > 0) {
    await mkdir(assetDirectory, { recursive: true });
    await Promise.all(Object.entries(assets).map(([name, bytes]) => writeFile(path.join(assetDirectory, name), bytes)));
  }
  return {
    directory, assetDirectory,
    build: () => execFileSync(process.execPath, [path.join(directory, 'scripts/build.mjs')], { encoding: 'utf8', stdio: 'pipe' }),
    output: () => readFile(path.join(directory, 'dist/index.html'), 'utf8'),
  };
}

function assertRejected(build, reason) {
  assert.throws(build, (error) => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, reason);
    return true;
  });
}

test('build embeds all source, removes stale output, and writes only index.html', async (t) => {
  const app = await fixture(t);
  await writeFile(path.join(app.directory, 'dist/old-asset.js'), 'stale');
  await mkdir(path.join(app.directory, 'dist/obsolete'));
  await writeFile(path.join(app.directory, 'dist/obsolete/data.json'), '{}');
  const diagnostics = app.build();
  assert.match(diagnostics, /Exported dist\/index\.html/);
  assert.doesNotMatch(diagnostics, /minified in:/);
  const output = await app.output();
  assert.deepEqual(await readdir(path.join(app.directory, 'dist')), ['index.html']);
  assert.match(output, /<style>body\{color:#fff\}<\/style>/);
  assert.match(output, /<script>globalThis\.ready=true;?<\/script>/);
  assert.doesNotMatch(output, /(?:src|href)=["']\.\//);
  assert.equal(await readFile(path.join(app.directory, 'src/app.js'), 'utf8'), 'globalThis.ready = true;');
});

test('build minifies HTML, CSS and JavaScript while preserving meaningful whitespace and literals', async (t) => {
  const html = template.replace('<main>Hustle Cards</main>', `
    <!-- disposable markup comment -->
    <main><span>Hustle</span> <span>Cards</span></main>
    <pre>  keep\n    this spacing</pre>
    <textarea>  keep\n    this too</textarea>
  `);
  const css = '/* disposable style comment */\nbody { color: #fff; margin: 0px; }\nbody::before { content: "A  B"; }';
  const js = `// disposable script comment
    const pattern = /a\\s+b/;
    const message = \`first line\nsecond line\`;
    function value() {
      return
      { unreachable: true };
    }
    globalThis.result = [pattern.test('a   b'), message, value()];
  `;
  const app = await fixture(t, { html, css, js });
  app.build();
  const output = await app.output();
  assert.doesNotMatch(output, /disposable/);
  assert.ok(output.includes('<span>Hustle</span> <span>Cards</span>'));
  assert.ok(output.includes('<pre>  keep\n    this spacing</pre>'));
  assert.ok(output.includes('<textarea>  keep\n    this too</textarea>'));
  assert.match(output, /content:["']A  B["']/);
  const embeddedJs = output.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const embeddedCss = output.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(embeddedJs.length < js.length);
  assert.ok(embeddedCss.length < css.length);
  const context = {};
  vm.runInNewContext(embeddedJs, context);
  assert.deepEqual(Array.from(context.result), [true, 'first line\nsecond line', undefined]);
});

test('JavaScript minification errors fail before replacing the existing export', async (t) => {
  const app = await fixture(t, { js: 'const broken = ;' });
  await writeFile(path.join(app.directory, 'dist/index.html'), 'previous export');
  assertRejected(app.build, /Build failed: Unexpected token/);
  assert.equal(await app.output(), 'previous export');
});

test('raw-text closing tags are escaped case-insensitively without changing JavaScript strings', async (t) => {
  const js = 'globalThis.payload = ["</script>", "</ScRiPt>", `</SCRIPT>`];';
  const css = 'body::before { content: "</StYlE>"; }';
  const app = await fixture(t, { js, css });
  app.build();
  const output = await app.output();
  const embeddedJs = output.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const embeddedCss = output.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(embeddedJs);
  assert.ok(embeddedCss);
  assert.doesNotMatch(embeddedJs, /<\/script/i);
  assert.doesNotMatch(embeddedCss, /<\/style/i);
  assert.match(embeddedCss, /\\3c\s*\/StYlE>/i);
  assert.equal([...output.matchAll(/<\/script>/gi)].length, 1);
  assert.equal([...output.matchAll(/<\/style>/gi)].length, 1);
  const context = {};
  vm.runInNewContext(embeddedJs, context);
  assert.deepEqual(Array.from(context.payload), ['</script>', '</ScRiPt>', '</SCRIPT>']);
});

test('inline favicon, SVG fragment and quoted data CSS references remain self-contained', async (t) => {
  const html = template.replace('</head>', '<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E"></head>')
    .replace('<main>', '<svg><use href="#star"></use></svg><main>');
  const css = 'body { filter: url("#glow"); background-image: url("data:image/svg+xml,%3Csvg/%3E"); }';
  const app = await fixture(t, { html, css });
  assert.match(app.build(), /Validated/);
  assert.match(await app.output(), /data:image\/svg\+xml/);
});

test('external and local linked resources fail the export with exit code 1', async (t) => {
  for (const href of ['https://example.com/icon.svg', './icon.svg']) {
    const app = await fixture(t, { html: template.replace('</head>', `<link rel="icon" href="${href}"></head>`) });
    assertRejected(app.build, /linked resource/);
  }
});

test('HTTPS navigation anchors are allowed while SVG resource hrefs remain inline-only', async (t) => {
  const anchor = '<a href="https://oliverjessner.at/">made by oliverjessner.at</a>';
  const app = await fixture(t, { html: template.replace('</main>', `${anchor}</main>`) });
  assert.match(app.build(), /Validated/);
  assert.ok((await app.output()).includes(anchor));
  for (const resource of [
    '<svg><use href="https://example.com/icons.svg#star"></use></svg>',
    '<svg><use xlink:href="https://example.com/icons.svg#star"></use></svg>',
    '<svg><image href="https://example.com/image.svg"></image></svg>',
  ]) {
    const external = await fixture(t, { html: template.replace('</main>', `${resource}</main>`) });
    assertRejected(external.build, /non-inline resource href/);
  }
});

test('external CSS imports, CSS URLs and media files fail the export', async (t) => {
  for (const css of ['@import "https://example.com/style.css";', 'body { background: url("./image.png"); }']) {
    const app = await fixture(t, { css });
    assertRejected(app.build, /CSS (?:imports|loads) a separate resource/);
  }
  const app = await fixture(t, { html: template.replace('<main>', '<img src="./image.png"><main>') });
  assertRejected(app.build, /approved WebP portrait/);
});

test('runtime fetch, imports and sockets fail the export', async (t) => {
  for (const js of ['fetch("https://example.com")', 'import("./module.js")', 'new WebSocket("wss://example.com")']) {
    const app = await fixture(t, { js });
    assertRejected(app.build, /runtime import or network request/);
  }
});

test('missing and duplicate source entry points fail rather than creating a partial export', async (t) => {
  for (const html of [template.replace('<link rel="stylesheet" href="./styles.css">', ''), template.replace('</body>', '<script src="./app.js"></script></body>')]) {
    const app = await fixture(t, { html });
    assertRejected(app.build, /Expected exactly one/);
    assert.deepEqual(await readdir(path.join(app.directory, 'dist')), []);
  }
});

test('portrait helper and application are bundled together in source order with safe IIFE boundaries', async (t) => {
  const portraits = `globalThis.order = []; (() => { globalThis.order.push('portraits'); })()`;
  const js = `(() => { globalThis.order.push('app'); })()`;
  const app = await fixture(t, { portraits, js });
  app.build();
  const output = await app.output();
  assert.equal([...output.matchAll(/<script\b/gi)].length, 1);
  assert.doesNotMatch(output, /<script\b[^>]*\bsrc\s*=/i);
  const context = {};
  vm.runInNewContext(output.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  assert.deepEqual(Array.from(context.order), ['portraits', 'app']);
});

test('portrait helper raw-text terminators are escaped and helper syntax errors preserve existing dist', async (t) => {
  const app = await fixture(t, { portraits: 'globalThis.helperText = "</SCRIPT>";' });
  app.build();
  const context = {};
  const script = (await app.output()).match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(script, /<\/script/i);
  vm.runInNewContext(script, context);
  assert.equal(context.helperText, '</SCRIPT>');
  await writeFile(path.join(app.directory, 'src/portraits.js'), 'const broken = ;');
  const previous = await app.output();
  assertRejected(app.build, /Unexpected token/);
  assert.equal(await app.output(), previous);
});

test('portrait source entry must appear exactly once before the application', async (t) => {
  for (const html of [
    template.replace(portraitEntry, ''),
    template.replace(portraitEntry, portraitEntry + portraitEntry),
    template.replace(portraitEntry + appEntry, appEntry + portraitEntry),
  ]) {
    const app = await fixture(t, { html });
    assertRejected(app.build, /(?:Expected exactly one portraits\.js|portraits\.js must appear before app\.js)/);
    assert.deepEqual(await readdir(path.join(app.directory, 'dist')), []);
  }
});

test('WebP portraits are copied byte for byte as separate approved files without encoding or inlining', async (t) => {
  const image = '<img src="./assets/legendary/founder-v1.webp" width="600" height="900" loading="lazy" decoding="async" alt="">';
  const app = await fixture(t, { html: template.replace('</main>', `${image}</main>`), assets: { 'founder-v1.webp': webp, '.gitkeep': '' } });
  assert.match(app.build(), /1 external WebP portrait asset/);
  const output = await app.output();
  assert.ok(output.includes('src="./assets/legendary/founder-v1.webp"'));
  assert.doesNotMatch(output, /data:image\/webp|base64/i);
  assert.deepEqual(await readFile(path.join(app.directory, 'dist/assets/legendary/founder-v1.webp')), webp);
  assert.deepEqual(await readdir(path.join(app.directory, 'dist')), ['assets', 'index.html']);
  assert.deepEqual(await readdir(path.join(app.directory, 'dist/assets')), ['legendary']);
  assert.deepEqual(await readdir(path.join(app.directory, 'dist/assets/legendary')), ['founder-v1.webp']);
  assert.equal(new URL('./assets/legendary/founder-v1.webp', 'https://example.com/products/hustlecards/index.html').pathname, '/products/hustlecards/assets/legendary/founder-v1.webp');
});

test('manifest-approved portrait paths also remain relative inside bundled JavaScript', async (t) => {
  for (const prefix of ['', './']) {
    const reference = `${prefix}assets/legendary/portrait-v2.webp`;
    const app = await fixture(t, { js: `globalThis.portrait = ${JSON.stringify(reference)};`, assets: { 'portrait-v2.webp': webp } });
    app.build();
    const context = {};
    vm.runInNewContext((await app.output()).match(/<script>([\s\S]*?)<\/script>/)[1], context);
    assert.equal(context.portrait, reference);
    assert.equal(new URL(context.portrait, 'https://example.com/subpath/').pathname, '/subpath/assets/legendary/portrait-v2.webp');
  }
});

test('rebuild removes deleted and obsolete portrait files but never copies the directory marker', async (t) => {
  const app = await fixture(t, { assets: { 'one.webp': webp, 'two.webp': webp, '.gitkeep': '' } });
  app.build();
  assert.deepEqual(await readdir(path.join(app.directory, 'dist/assets/legendary')), ['one.webp', 'two.webp']);
  await rm(path.join(app.assetDirectory, 'two.webp'));
  app.build();
  assert.deepEqual(await readdir(path.join(app.directory, 'dist/assets/legendary')), ['one.webp']);
  await rm(path.join(app.assetDirectory, 'one.webp'));
  app.build();
  assert.deepEqual(await readdir(path.join(app.directory, 'dist')), ['index.html']);
});

test('unsupported image formats and filenames fail before replacing an existing distribution', async (t) => {
  for (const name of ['photo.png', 'portrait.JPG', 'Portrait.webp', 'portrait space.webp', '.hidden.webp', 'portrait.webp.js']) {
    const app = await fixture(t, { assets: { [name]: webp } });
    await writeFile(path.join(app.directory, 'dist/index.html'), 'previous distribution');
    assertRejected(app.build, /Only lowercase WebP portrait filenames/);
    assert.equal(await app.output(), 'previous distribution');
  }
  const invalid = await fixture(t, { assets: { 'spoofed.webp': Buffer.from('This is not a WebP image.') } });
  await writeFile(path.join(invalid.directory, 'dist/index.html'), 'previous distribution');
  assertRejected(invalid.build, /Invalid WebP portrait/);
  assert.equal(await invalid.output(), 'previous distribution');
});

test('nested and symlinked portrait entries cannot be copied into the distribution', async (t) => {
  const app = await fixture(t, { assets: { '.gitkeep': '' } });
  await mkdir(path.join(app.assetDirectory, 'nested'));
  assertRejected(app.build, /Unsupported Legendary asset entry/);
  await rm(path.join(app.assetDirectory, 'nested'), { recursive: true });
  const outside = path.join(app.directory, 'outside.webp');
  await writeFile(outside, webp);
  await symlink(outside, path.join(app.assetDirectory, 'linked.webp'));
  assertRejected(app.build, /Unsupported Legendary asset entry/);
  await rm(path.join(app.assetDirectory, 'linked.webp'));
  await rm(app.assetDirectory, { recursive: true });
  const outsideDirectory = path.join(app.directory, 'outside-assets');
  await mkdir(outsideDirectory);
  await symlink(outsideDirectory, app.assetDirectory);
  assertRejected(app.build, /Legendary asset directory must be a real directory/);
});

test('portrait HTML references must use existing approved relative paths with no inline encoding or extra requests', async (t) => {
  for (const src of [
    './assets/legendary/missing.webp', '/assets/legendary/portrait.webp', '../assets/legendary/portrait.webp',
    'https://example.com/assets/legendary/portrait.webp', '//example.com/portrait.webp',
    'data:image/webp;base64,AAAA', './assets/legendary/portrait.webp?v=1', './assets/legendary/../portrait.webp',
  ]) {
    const app = await fixture(t, { html: template.replace('</main>', `<img src="${src}"></main>`), assets: { 'portrait.webp': webp } });
    assertRejected(app.build, /approved WebP portrait/);
  }
  const sourceSet = await fixture(t, { html: template.replace('</main>', '<img src="./assets/legendary/portrait.webp" srcset="./assets/legendary/portrait.webp 2x"></main>'), assets: { 'portrait.webp': webp } });
  assertRejected(sourceSet.build, /approved WebP portrait/);
});

test('portrait URL contracts also reject invalid bundled JavaScript paths and raster data URLs', async (t) => {
  for (const reference of ['/assets/legendary/portrait.webp', 'https://example.com/assets/legendary/portrait.webp', './assets/legendary/missing.webp', './assets/legendary/portrait.webp?cache=0']) {
    const app = await fixture(t, { js: `globalThis.portrait = ${JSON.stringify(reference)};`, assets: { 'portrait.webp': webp } });
    assertRejected(app.build, /unapproved or missing portrait asset/);
  }
  const embedded = await fixture(t, { js: 'globalThis.portrait = "data:image/webp;base64,AAAA";' });
  assertRejected(embedded.build, /external assets, never data URLs/);
  const embeddedCss = await fixture(t, { css: 'body { background: url("data:image/webp;base64,AAAA"); }' });
  assertRejected(embeddedCss.build, /external assets, never data URLs/);
});

test('every inline script is checked and preloading or rebasing portraits is rejected', async (t) => {
  const extraScript = await fixture(t, { html: template.replace('</body>', '<script>fetch("https://example.com")</script></body>') });
  assertRejected(extraScript.build, /runtime import or network request/);
  const helperNetwork = await fixture(t, { portraits: 'fetch("https://example.com");' });
  assertRejected(helperNetwork.build, /runtime import or network request/);
  const preload = await fixture(t, { html: template.replace('</head>', '<link rel="preload" as="image" href="./assets/legendary/portrait.webp"></head>'), assets: { 'portrait.webp': webp } });
  assertRejected(preload.build, /linked resource/);
  const rebased = await fixture(t, { html: template.replace('</head>', '<base href="/"></head>') });
  assertRejected(rebased.build, /base URL/);
});
