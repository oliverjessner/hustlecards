import { readFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const destination = path.join(root, 'dist');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeRawText(text, tag) {
  return tag === 'style'
    ? text.replace(/<\/style/gi, (value) => `\\3c /${value.slice(2)}`)
    : text.replace(/<\/script/gi, (value) => `<\\/${value.slice(2)}`);
}

function validateExport(html) {
  assert(/<!doctype html>/i.test(html), 'The export needs an HTML5 doctype.');
  assert(/<style\b[^>]*>[\s\S]+?<\/style>/i.test(html), 'Inline CSS is missing.');
  assert(/<script\b[^>]*>[\s\S]+?<\/script>/i.test(html), 'Inline JavaScript is missing.');
  assert(!/<script\b[^>]*\bsrc\s*=/i.test(html), 'An external script remains.');
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] ?? '';
    const relation = tag.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2] ?? '';
    assert(/^(?:shortcut\s+)?icon$/i.test(relation) && /^data:image\//i.test(href), 'A linked resource remains.');
  }
  assert(!/<(?:img|iframe|audio|video|source|track|embed|object)\b[^>]*\b(?:src|srcset|data|poster)\s*=/i.test(html), 'A separate media resource remains.');
  assert(!/\b(?:src|srcset|poster)\s*=\s*["'][^"']+["']/i.test(html), 'A runtime file reference remains.');
  for (const [tag, name] of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    for (const [, , value] of tag.matchAll(/\s(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)) {
      const reference = value.trim();
      const inline = /^(?:#|data:)/i.test(reference);
      const navigation = name.toLowerCase() === 'a' && /^https:\/\//i.test(reference);
      assert(inline || navigation, 'A non-inline resource href remains.');
    }
  }
  assert(!/@import\s/i.test(html), 'CSS imports a separate resource.');
  for (const match of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const reference = (match[1] ?? match[2] ?? match[3]).trim();
    assert(/^(?:data:|#)/i.test(reference), 'CSS loads a separate resource.');
  }
  const inlineScript = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? '';
  assert(!/\b(?:import\s*(?:\(|["'{*])|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)/.test(inlineScript), 'JavaScript contains a runtime import or network request.');
}

try {
  const { minify } = await import('html-minifier-terser');
  const [template, css, javascript] = await Promise.all([
    readFile(path.join(source, 'index.html'), 'utf8'),
    readFile(path.join(source, 'styles.css'), 'utf8'),
    readFile(path.join(source, 'app.js'), 'utf8'),
  ]);

  const stylesheet = /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'](?:\.\/)?styles\.css["'])[^>]*>/gi;
  const script = /<script\b(?=[^>]*\bsrc=["'](?:\.\/)?app\.js["'])[^>]*>\s*<\/script>/gi;
  assert([...template.matchAll(stylesheet)].length === 1, 'Expected exactly one styles.css reference in src/index.html.');
  assert([...template.matchAll(script)].length === 1, 'Expected exactly one app.js reference in src/index.html.');

  // HTML raw-text elements terminate even inside CSS/JS strings or comments.
  // These language-native escapes preserve the text while protecting the parser.
  const safeCss = escapeRawText(css, 'style');
  const safeJavascript = escapeRawText(javascript, 'script');
  const inlined = template
    .replace(stylesheet, () => `<style>\n${safeCss}\n</style>`)
    .replace(script, () => `<script>\n${safeJavascript}\n</script>`);

  // Validate the original sources before optimizers can discard any references.
  validateExport(inlined);
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
    .replace(stylesheet, () => `<style>${compactCss}</style>`)
    .replace(script, () => `<script>${compactJavascript}</script>`), {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    keepClosingSlash: true,
  })).trimEnd() + '\n';
  validateExport(html);
  // Only the generated destination is removed; source and repository files stay intact.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const output = path.join(destination, 'index.html');
  await writeFile(output, html, 'utf8');
  const files = await readdir(destination);
  assert(files.length === 1 && files[0] === 'index.html', 'dist must contain only index.html.');
  const written = await readFile(output, 'utf8');
  validateExport(written);
  assert(written === html, 'The written export differs from the generated HTML.');
  const bytes = Buffer.byteLength(written, 'utf8');
  console.log(`Exported dist/index.html — ${(bytes / 1024).toFixed(2)} KiB (${bytes.toLocaleString('en-US')} bytes).`);
  console.log('Validated: one minified file, inline CSS and JavaScript, no runtime resources or network requests.');
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
