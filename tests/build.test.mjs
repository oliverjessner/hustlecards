import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const template = '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"></head><body><main>Hustle Cards</main><script src="./app.js" defer></script></body></html>';

async function fixture(t, { html = template, css = 'body { color: #fff; }', js = 'globalThis.ready = true;' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hustle-cards-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all(['src', 'scripts', 'dist'].map((name) => mkdir(path.join(directory, name))));
  await Promise.all([
    writeFile(path.join(directory, 'scripts/build.mjs'), builder),
    writeFile(path.join(directory, 'src/index.html'), html),
    writeFile(path.join(directory, 'src/styles.css'), css),
    writeFile(path.join(directory, 'src/app.js'), js),
  ]);
  return {
    directory,
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
  assertRejected(app.build, /media resource/);
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
