import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = { host: '127.0.0.1', port: process.env.PORT ?? '5173', directory: 'src' };

function usage(message) {
  if (message) console.error(message);
  console.log('Usage: npm run dev -- [--host 127.0.0.1] [--port 5173] [--dist]');
  process.exit(message ? 1 : 0);
}

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--help' || argument === '-h') usage();
  if (argument === '--dist') {
    options.directory = 'dist';
  } else if (argument === '--host' || argument === '--port') {
    const value = args[++index];
    if (!value || value.startsWith('--')) usage(`Missing value for ${argument}.`);
    options[argument.slice(2)] = value;
  } else {
    usage(`Unknown argument: ${argument}`);
  }
}

const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) usage('The port must be an integer between 1 and 65535.');
const directory = path.join(project, options.directory);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function insideDirectory(filename) {
  const relative = path.relative(directory, filename);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (pathname.includes('\0') || pathname.includes('\\')) throw new URIError('Invalid path');
    let filename = path.resolve(directory, `.${pathname}`);
    if (!insideDirectory(filename)) throw new URIError('Invalid path');
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    filename = await realpath(filename);
    if (!insideDirectory(filename)) throw new URIError('Invalid path');
    const content = await readFile(filename);
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
      'Content-Length': content.byteLength,
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error instanceof URIError ? 400 : 404;
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(status === 400 ? 'Invalid path' : 'Not found');
  }
});

server.on('error', (error) => {
  console.error(`Could not start the development server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, options.host, () => {
  console.log(`HUSTLE CARDS — http://${options.host}:${port}`);
  console.log(`Serving ${options.directory}/. Press Ctrl+C to stop.`);
});
