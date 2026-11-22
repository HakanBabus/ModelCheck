import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launchBrowser, startIsolatedSite } from './local-browser.mjs';

const HELP = `ModelCheck
Usage: npm run inspect -- <model.glb> [options]

  --baseline <file.glb>  Compare against an earlier version using shared coordinates
  --out <path.png>      Default: review/<name>-review.png or review/<name>-comparison.png
  --report <path.json>  Default: the PNG path with a .json suffix
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
      baseline: { type: 'string' },
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
  const baselinePath = values.baseline === undefined ? null : resolve(values.baseline);
  if (baselinePath && extname(baselinePath).toLowerCase() !== '.glb') throw new Error('--baseline must point to a .glb file.');
  const suffix = view === 'sheet' ? 'review' : view;
  const comparisonSuffix = view === 'sheet' ? 'comparison' : `comparison-${view}`;
  const png = resolve(values.out ?? `review/${name.slice(0, -4)}-${baselinePath ? comparisonSuffix : suffix}.png`);
  if (extname(png).toLowerCase() !== '.png') throw new Error('--out must end in .png.');
  const json = resolve(values.report ?? `${png.slice(0, -4)}.json`);
  if (extname(json).toLowerCase() !== '.json') throw new Error('--report must end in .json.');
  const [data, baselineData] = await Promise.all([
    readFile(input), baselinePath && readFile(baselinePath),
  ]);
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
    if (baselinePath) {
      await page.locator('#baseline-file').setInputFiles({
        name: basename(baselinePath), mimeType: 'model/gltf-binary', buffer: baselineData,
      });
    }
    const { base64, comparison } = await page.evaluate(async (options) => {
      const baseline = document.getElementById('baseline-file').files[0];
      let image;
      let comparison;
      if (baseline) {
        const result = await window.modelCheck.compare(baseline, options);
        image = result.image;
        comparison = {
          baseline: result.baseline, delta: result.delta, framing: result.framing, identityStatus: result.identityStatus,
        };
      } else {
        image = await window.modelCheck.capture(options);
      }
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(image);
      });
      return { base64, comparison };
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
    if (comparison) {
      output.baseline = { ...comparison.baseline, sha256: createHash('sha256').update(baselineData).digest('hex') };
      output.delta = comparison.delta;
      output.framing = comparison.framing;
      output.identityStatus = comparison.identityStatus;
    }
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
