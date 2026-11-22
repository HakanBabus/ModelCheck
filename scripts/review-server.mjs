import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const directory = process.argv[2];
const paths = new Map([['/', 'index.html'], ['/index.html', 'index.html']]);
for (const file of await readdir(directory, { withFileTypes: true })) {
  if (file.isFile() && ['review.json', 'current.glb', 'baseline.glb'].includes(file.name)) {
    paths.set(`/${file.name}`, file.name);
  }
}
for (const file of await readdir(join(directory, 'assets'), { withFileTypes: true })) {
  if (file.isFile()) paths.set(`/assets/${file.name}`, `assets/${file.name}`);
}
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
};
const IDLE_MS = 60 * 60 * 1000;
let idle;
const server = createServer((request, response) => {
  if (request.headers.host !== `127.0.0.1:${server.address().port}`) {
    response.writeHead(421).end();
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const file = paths.get(request.url?.split('?')[0]);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  idle.refresh();
  const headers = {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method === 'HEAD') {
    response.writeHead(200, headers).end();
    return;
  }
  const stream = createReadStream(join(directory, file));
  response.once('close', () => stream.destroy());
  stream.once('open', () => {
    response.writeHead(200, headers);
    stream.pipe(response);
  });
  stream.once('error', () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(404).end();
  });
});

server.listen(0, '127.0.0.1', () => {
  idle = setTimeout(() => server.close(), IDLE_MS);
  idle.unref();
  process.send?.(server.address().port);
});
