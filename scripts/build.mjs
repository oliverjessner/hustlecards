import { readFile, mkdir, readdir, lstat, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const destination = path.join(root, 'dist');
const portraitDirectory = path.join(source, 'assets', 'legendary');
const portraitName = /^[a-z0-9][a-z0-9_-]*\.webp$/;
const portraitUrl = /^(?:\.\/)?assets\/legendary\/([a-z0-9][a-z0-9_-]*\.webp)$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeRawText(text, tag) {
  return tag === 'style'
    ? text.replace(/<\/style/gi, (value) => `\\3c /${value.slice(2)}`)
    : text.replace(/<\/script/gi, (value) => `<\\/${value.slice(2)}`);
}

async function portraitAssets() {
  let directory;
  try { directory = await lstat(portraitDirectory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  assert(directory.isDirectory() && !directory.isSymbolicLink(), 'The Legendary asset directory must be a real directory.');
  assert(!(await lstat(path.dirname(portraitDirectory))).isSymbolicLink(), 'The asset parent directory cannot be a symlink.');
  const entries = (await readdir(portraitDirectory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(entries.map(async (entry) => {
    assert(entry.isFile() && !entry.isSymbolicLink(), `Unsupported Legendary asset entry: ${entry.name}.`);
    if (entry.name === '.gitkeep' || entry.name === '.DS_Store') return null;
    assert(portraitName.test(entry.name), `Only lowercase WebP portrait filenames are allowed: ${entry.name}.`);
    const bytes = await readFile(path.join(portraitDirectory, entry.name));
    assert(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP', `Invalid WebP portrait: ${entry.name}.`);
    return { filename: `assets/legendary/${entry.name}`, bytes };
  })).then((assets) => assets.filter(Boolean));
}

function approvedPortrait(reference, assets) {
  const match = portraitUrl.exec(reference);
  return match !== null && assets.has(`assets/legendary/${match[1]}`);
}

function validateExport(html, assets) {
  assert(/<!doctype html>/i.test(html), 'The export needs an HTML5 doctype.');
  assert(/<style\b[^>]*>[\s\S]+?<\/style>/i.test(html), 'Inline CSS is missing.');
  assert(/<script\b[^>]*>[\s\S]+?<\/script>/i.test(html), 'Inline JavaScript is missing.');
  assert(!/<script\b[^>]*\bsrc\s*=/i.test(html), 'An external script remains.');
  // Restrict real HTML attributes, rather than mistaking quoted JS markup for tags.
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const [tag] of markup.matchAll(/<link\b[^>]*>/gi)) {
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] ?? '';
    const relation = tag.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2] ?? '';
    assert(/^(?:shortcut\s+)?icon$/i.test(relation) && /^data:image\//i.test(href), 'A linked resource remains.');
  }
  assert(!/<(?:iframe|audio|video|source|track|embed|object)\b[^>]*\b(?:src|srcset|data|poster)\s*=/i.test(markup), 'A separate media resource remains.');
  assert(!/<base\b/i.test(markup), 'A base URL would break relative portrait paths.');
  for (const [tag, name] of markup.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    for (const attribute of tag.matchAll(/\s(src|srcset|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const [, kind, doubleQuoted, singleQuoted, unquoted] = attribute;
      const reference = doubleQuoted ?? singleQuoted ?? unquoted;
      assert(name.toLowerCase() === 'img' && kind.toLowerCase() === 'src' && approvedPortrait(reference, assets), 'A runtime file reference is not an approved WebP portrait.');
    }
    for (const [, , value] of tag.matchAll(/\s(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)) {
      const reference = value.trim();
      const inline = /^(?:#|data:)/i.test(reference);
      const navigation = name.toLowerCase() === 'a' && /^https:\/\//i.test(reference);
      assert(inline || navigation, 'A non-inline resource href remains.');
    }
  }
  const styles = [
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]),
    ...[...markup.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((match) => match[1] ?? match[2]),
  ].join('\n');
  assert(!/@import\s/i.test(styles), 'CSS imports a separate resource.');
  for (const match of styles.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const reference = (match[1] ?? match[2] ?? match[3]).trim();
    assert(/^(?:data:|#)/i.test(reference), 'CSS loads a separate resource.');
    assert(!/^data:image\/(?:webp|jpe?g|png|avif|gif)/i.test(reference), 'Portrait images must remain external assets, never data URLs.');
  }
  for (const [, inlineScript] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    assert(!/\b(?:import\s*(?:\(|["'{*])|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)/.test(inlineScript), 'JavaScript contains a runtime import or network request.');
    assert(!/data:image\//i.test(inlineScript), 'Portrait images must remain external assets, never data URLs.');
    for (const [, reference] of inlineScript.matchAll(/["'`]([^"'`]*assets\/legendary\/[^"'`]+)["'`]/g)) {
      assert(approvedPortrait(reference, assets), 'JavaScript references an unapproved or missing portrait asset.');
    }
  }
}

async function distributionFiles(directory = destination, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await distributionFiles(path.join(directory, entry.name), `${relative}/`));
    else {
      assert(entry.isFile() && !entry.isSymbolicLink(), `Unexpected distribution entry: ${relative}.`);
      files.push(relative);
    }
  }
  return files.sort();
}

try {
  const { minify } = await import('html-minifier-terser');
  const [template, css, portraits, application, images] = await Promise.all([
    readFile(path.join(source, 'index.html'), 'utf8'),
    readFile(path.join(source, 'styles.css'), 'utf8'),
    readFile(path.join(source, 'portraits.js'), 'utf8'),
    readFile(path.join(source, 'app.js'), 'utf8'),
    portraitAssets(),
  ]);
  const assets = new Set(images.map((image) => image.filename));
  const javascript = [portraits, application].filter((text) => text.trim()).join('\n;\n');

  const stylesheet = /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'](?:\.\/)?styles\.css["'])[^>]*>/gi;
  const script = /<script\b(?=[^>]*\bsrc=["'](?:\.\/)?app\.js["'])[^>]*>\s*<\/script>/gi;
  const portraitScript = /<script\b(?=[^>]*\bsrc=["'](?:\.\/)?portraits\.js["'])[^>]*>\s*<\/script>/gi;
  assert([...template.matchAll(stylesheet)].length === 1, 'Expected exactly one styles.css reference in src/index.html.');
  assert([...template.matchAll(script)].length === 1, 'Expected exactly one app.js reference in src/index.html.');
  assert([...template.matchAll(portraitScript)].length === 1, 'Expected exactly one portraits.js reference in src/index.html.');
  assert([...template.matchAll(portraitScript)][0].index < [...template.matchAll(script)][0].index, 'portraits.js must appear before app.js.');

  // HTML raw-text elements terminate even inside CSS/JS strings or comments.
  // These language-native escapes preserve the text while protecting the parser.
  const safeCss = escapeRawText(css, 'style');
  const safeJavascript = escapeRawText(javascript, 'script');
  const inlined = template
    .replace(portraitScript, '')
    .replace(stylesheet, () => `<style>\n${safeCss}\n</style>`)
    .replace(script, () => `<script>\n${safeJavascript}\n</script>`);

  // Validate the original sources before optimizers can discard any references.
  validateExport(inlined, assets);
  async function minifyChecked(text, options) {
    const errors = [];
    const result = await minify(text, {
      ...options,
      log: (entry) => {
        // html-minifier-terser reports successful timing through the same callback
        // as CleanCSS and Terser errors. Collect failures so asynchronous CSS
        // callbacks can finish before we reject the export.
        if (typeof entry === 'string' && /^minified in: \d+ms$/.test(entry)) return;
        errors.push(entry instanceof Error ? entry.message : String(entry));
      },
    });
    assert(errors.length === 0, errors.join('\n'));
    return result;
  }
  async function minifyRawText(tag, text, options) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const result = await minifyChecked(`${open}${text}${close}`, options);
    assert(result.startsWith(open) && result.endsWith(close), `Unexpected minified ${tag} wrapper.`);
    // Protect the HTML parser again in case an optimizer rewrites string escapes.
    return escapeRawText(result.slice(open.length, -close.length), tag);
  }
  const compactCss = await minifyRawText('style', safeCss, {
    minifyCSS: { level: 1, rebase: false },
  });
  const compactJavascript = await minifyRawText('script', safeJavascript, {
    minifyJS: { compress: false, mangle: false, format: { comments: false, inline_script: true } },
  });
  const html = (await minifyChecked(template
    .replace(portraitScript, '')
    .replace(stylesheet, () => `<style>${compactCss}</style>`)
    .replace(script, () => `<script>${compactJavascript}</script>`), {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    keepClosingSlash: true,
  })).trimEnd() + '\n';
  validateExport(html, assets);
  // Only the generated destination is removed; source and repository files stay intact.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const output = path.join(destination, 'index.html');
  await writeFile(output, html, 'utf8');
  if (images.length > 0) {
    await mkdir(path.join(destination, 'assets', 'legendary'), { recursive: true });
    await Promise.all(images.map((image) => writeFile(path.join(destination, image.filename), image.bytes)));
  }
  const files = await distributionFiles();
  const expected = ['index.html', ...assets].sort();
  assert(JSON.stringify(files) === JSON.stringify(expected), 'dist must contain only index.html and approved Legendary portrait assets.');
  for (const image of images) assert((await readFile(path.join(destination, image.filename))).equals(image.bytes), `Copied portrait differs: ${image.filename}.`);
  const written = await readFile(output, 'utf8');
  validateExport(written, assets);
  assert(written === html, 'The written export differs from the generated HTML.');
  const bytes = Buffer.byteLength(written, 'utf8');
  console.log(`Exported dist/index.html — ${(bytes / 1024).toFixed(2)} KiB (${bytes.toLocaleString('en-US')} bytes).`);
  console.log(`Validated: bundled HTML/CSS/JavaScript, ${images.length} external WebP portrait asset(s), no runtime dependencies.`);
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
