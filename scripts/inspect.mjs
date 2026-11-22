import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launchBrowser, startIsolatedSite } from './local-browser.mjs';

const HELP = `ModelCheck
Usage: npm run inspect -- <model.glb> [options]

  --out <path.png>      Default: review/<name>-review.png
  --report <path.json> Default: the PNG path with a .json suffix
  --view <view>         sheet | front | right | top | iso (default: sheet)
  --size <px>           PNG width, integer 480–2400 (default: 1200)
  --browser <channel>   Optional installed browser, e.g. msedge or chrome
  --help                Show this help

Use npm run --silent inspect for JSON-only stdout.`;

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, contents, { flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

async function inspect() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' }, report: { type: 'string' },
      view: { type: 'string', default: 'sheet' }, size: { type: 'string', default: '1200' },
      browser: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(HELP);
  if (positionals.length !== 1 || extname(positionals[0]).toLowerCase() !== '.glb') {
    throw new Error('Provide one .glb file. See --help for usage.');
  }
  const view = values.view;
  const size = Number(values.size);
  if (!['sheet', 'front', 'right', 'top', 'iso'].includes(view)) throw new Error('Invalid --view.');
  if (!Number.isInteger(size) || size < 480 || size > 2400) throw new Error('--size must be an integer from 480 to 2400.');
  const input = resolve(positionals[0]);
  const name = basename(input);
  const png = resolve(values.out ?? `review/${name.slice(0, -4)}-${view === 'sheet' ? 'review' : view}.png`);
  if (extname(png).toLowerCase() !== '.png') throw new Error('--out must end in .png.');
  const json = resolve(values.report ?? `${png.slice(0, -4)}.json`);
  if (extname(json).toLowerCase() !== '.json') throw new Error('--report must end in .json.');
  const data = await readFile(input);
  const site = await startIsolatedSite();
  let browser;
  try {
    browser = await launchBrowser(values.browser);
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    await page.goto(`${site.url}?automation`);
    await page.locator('#state:is([data-phase="idle"], [data-phase="error"])').waitFor();
    if (await page.locator('#state').getAttribute('data-phase') === 'idle') {
      await page.locator('#files').setInputFiles({ name, mimeType: 'model/gltf-binary', buffer: data });
      await page.locator('#state:is([data-phase="ready"], [data-phase="error"])').waitFor();
    }
    const report = await page.evaluate(() => window.modelCheck?.report());
    if (!report) throw new Error(await page.locator('#stage-message').textContent());
    const base64 = await page.evaluate(async (options) => {
      const image = await window.modelCheck.capture(options);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(image);
      });
    }, { view, size });
    const image = Buffer.from(base64, 'base64');
    const output = {
      schemaVersion: 1,
      model: { ...report, sha256: createHash('sha256').update(data).digest('hex') },
      capture: {
        view, width: image.readUInt32BE(16), height: image.readUInt32BE(20),
        sha256: createHash('sha256').update(image).digest('hex'),
      },
    };
    await writeAtomic(png, image);
    await writeAtomic(json, JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ png, report: json, view }));
  } finally {
    try { await browser?.close(); } finally { await site.close(); }
  }
}

inspect().catch((error) => {
  console.error(`ModelCheck: ${error.message}`);
  process.exitCode = 1;
});
