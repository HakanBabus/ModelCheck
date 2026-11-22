import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { launchBrowser, startSite } from './local-browser.mjs';

const run = promisify(execFile);
const sample = 'public/rover.glb';
const temp = await mkdtemp(join(tmpdir(), 'modelcheck-test-'));
let browser;
let site;

function sizeOfPng(bytes) {
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

try {
  const folder = join(temp, 'models');
  const nested = join(folder, 'nested');
  await mkdir(nested, { recursive: true });
  await copyFile(sample, join(folder, 'first.glb'));
  await copyFile(sample, join(nested, 'second.GLB'));
  await writeFile(join(folder, 'notes.txt'), 'Ignored');

  site = await startSite();
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const ready = () => page.locator('#state[data-phase="ready"]').waitFor();
  await page.goto(site.url);
  await ready();
  assert.equal(await page.locator('h1').textContent(), 'rover.glb');
  assert.equal(await page.locator('#grid svg').count(), 1);
  const sampleData = await page.evaluate(() => window.modelCheck.report());
  assert.equal(sampleData.meshes, 88);
  assert.equal(sampleData.triangles, 5584);
  assert.equal(sampleData.materials, 5);

  await page.locator('#folder').setInputFiles(folder);
  await ready();
  assert.equal(await page.locator('#count').textContent(), '2');
  await page.locator('#search').fill('nested');
  assert.equal(await page.locator('.model-item').count(), 1);
  await page.locator('.model-item').click();
  await ready();
  assert.equal(await page.locator('h1').textContent(), 'second.GLB');

  await page.locator('#files').setInputFiles({
    name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('invalid'),
  });
  await page.locator('#state[data-phase="error"]').waitFor();
  assert.match(await page.locator('#stage-message').textContent(), /too small/);
  await page.locator('#files').setInputFiles(sample);
  await ready();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  assert.equal(await page.locator('[data-view=right]').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Toggle wireframe' }).click();
  assert.equal(await page.locator('#wireframe').getAttribute('aria-pressed'), 'true');
  const [snapshot] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Save current view' }).click(),
  ]);
  assert.equal(sizeOfPng(await readFile(await snapshot.path()))[0], 1200);
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Download review PNG' }).click(),
  ]);
  assert.equal(download.suggestedFilename(), 'rover-review.png');
  const browserPng = await readFile(await download.path());
  assert.deepEqual(sizeOfPng(browserPng), [1200, 939]);
  assert.equal(await page.locator('#wireframe').getAttribute('aria-pressed'), 'true');
  const [metadata] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Download model data' }).click(),
  ]);
  assert.deepEqual(JSON.parse(await readFile(await metadata.path(), 'utf8')), sampleData);
  await page.reload();
  await ready();
  if (process.env.MODELCHECK_DESKTOP_SCREENSHOT) {
    await page.screenshot({ path: process.env.MODELCHECK_DESKTOP_SCREENSHOT, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (process.env.MODELCHECK_MOBILE_SCREENSHOT) {
    await page.screenshot({ path: process.env.MODELCHECK_MOBILE_SCREENSHOT, fullPage: true });
  }
  await page.goto(`${site.url}?automation`);
  await page.locator('#state[data-phase="idle"]').waitFor();
  const api = await page.evaluate(async () => {
    const data = await fetch('./rover.glb').then((response) => response.arrayBuffer());
    const report = await window.modelCheck.open(new File([data], 'api.glb'));
    const image = await window.modelCheck.capture({ view: 'right', size: 640 });
    return { name: report.name, triangles: report.triangles, imageType: image.type, size: image.size };
  });
  assert.equal(api.name, 'api.glb');
  assert.equal(api.triangles, sampleData.triangles);
  assert.equal(api.imageType, 'image/png');
  assert(api.size > 1000);

  await page.evaluate(async () => {
    const data = await fetch('./rover.glb').then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'dropped.glb'));
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', {
      dataTransfer: transfer, bubbles: true, cancelable: true,
    }));
  });
  await ready();
  assert.equal(await page.locator('h1').textContent(), 'dropped.glb');
  assert.deepEqual(pageErrors, []);

  const output = join(temp, 'review space', 'model.png');
  const { stdout } = await run(process.execPath, ['scripts/inspect.mjs', sample, '--out', output]);
  const response = JSON.parse(stdout);
  assert.equal(response.png, output);
  const report = JSON.parse(await readFile(response.report, 'utf8'));
  assert.equal(report.model.triangles, sampleData.triangles);
  assert.equal(report.capture.width, 1200);
  assert.deepEqual(await readFile(output), browserPng);
  const isolated = join(temp, 'top.png');
  await run(process.execPath, ['scripts/inspect.mjs', sample, '--out', isolated, '--view', 'top', '--size', '640']);
  assert.deepEqual(sizeOfPng(await readFile(isolated)), [640, 457]);
  await assert.rejects(run(process.execPath, ['scripts/inspect.mjs', sample, '--size', '399']), /size must/);
  console.log('Passed: sample, folder/filter, drag/drop, invalid-file recovery, camera, exports, browser API, CLI parity and mobile layout.');
} finally {
  try { await browser?.close(); } finally {
    try { await site?.close(); } finally { await rm(temp, { recursive: true, force: true }); }
  }
}
