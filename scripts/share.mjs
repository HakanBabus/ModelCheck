import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';
import { validatePinFile } from '../src/review-pins.js';

const HELP = `ModelCheck share
Usage: npm run --silent share -- <model.glb> [options]

  --baseline <file.glb>  Include an earlier revision
  --pins <file.json>     Include saved pins from the current GLB
  --title <text>         Title shown in the viewer
  --note <text>          Note for the reviewer
  --dir <directory>     Parent for generated review folders (default: review/links)
  --static              Save the review folder for hosting without starting a local server
  --help                Show usage

The command prints JSON. A local URL works on this computer while its server runs.
For a link another computer can open, publish the generated folder to a static host.
`;

async function resolveModel(path) {
  const file = resolve(path);
  if (extname(file).toLowerCase() !== '.glb') throw new Error('Choose a .glb file.');
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const data = Buffer.alloc(20);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    if (bytesRead < 20 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2
        || data.readUInt32LE(8) !== size || data.readUInt32LE(12) + 20 > size || data.toString('ascii', 16, 20) !== 'JSON') {
      throw new Error(`${basename(file)} is not a valid GLB 2.0 file.`);
    }
    return file;
  } finally {
    await handle.close();
  }
}

async function resolvePins(path) {
  const input = await open(path);
  try {
    if ((await input.stat()).size > 512 * 1024) throw new Error('This pins file is too large.');
    return validatePinFile(JSON.parse(await input.readFile('utf8')));
  } finally {
    await input.close();
  }
}

function startReviewServer(directory) {
  const script = fileURLToPath(new URL('./review-server.mjs', import.meta.url));
  const child = fork(script, [directory], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out waiting for the review server.'));
    }, 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Review server exited before it was ready (${code}).`));
    });
    child.once('message', (port) => {
      clearTimeout(timer);
      child.disconnect();
      child.unref();
      resolve({ url: `http://127.0.0.1:${port}/`, serverPid: child.pid });
    });
  });
}

async function share() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      baseline: { type: 'string' }, pins: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' },
      dir: { type: 'string', default: 'review/links' }, static: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(HELP);
  if (positionals.length !== 1) throw new Error('Provide one current .glb path. See --help.');
  const [current, baseline, pins] = await Promise.all([
    resolveModel(positionals[0]), values.baseline ? resolveModel(values.baseline) : null,
    values.pins ? resolvePins(values.pins) : undefined,
  ]);
  const parent = resolve(values.dir);
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'modelcheck-'));
  const entry = join(directory, 'index.html');
  try {
    const currentFile = join(directory, 'current.glb');
    await copyFile(current, currentFile);
    if (pins) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(currentFile)) hash.update(chunk);
      if (hash.digest('hex') !== pins.modelSha256) throw new Error('These pins belong to a different GLB file.');
    }
    if (baseline) await copyFile(baseline, join(directory, 'baseline.glb'));
    await build({ publicDir: false, build: { outDir: directory, emptyOutDir: false }, logLevel: 'silent' });
    const manifest = {
      version: 1,
      title: values.title?.trim().slice(0, 160) || 'Shared review',
      note: values.note?.trim().slice(0, 1200),
      current: basename(current),
      baseline: baseline ? basename(baseline) : null,
      pins,
    };
    await writeFile(join(directory, 'review.json'), JSON.stringify(manifest, null, 2) + '\n');
    const html = await readFile(entry, 'utf8');
    await writeFile(entry, html.replace('<html lang="en">', '<html lang="en" data-shared-review>'));
    const location = values.static ? { url: null, scope: 'static' } : {
      ...await startReviewServer(directory), scope: 'local',
    };
    console.log(JSON.stringify({ ...location, directory, entry }));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

share().catch((error) => {
  console.error(`ModelCheck share: ${error.message}`);
  process.exitCode = 1;
});
