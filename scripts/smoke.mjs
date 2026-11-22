import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { launchBrowser, startSite } from './local-browser.mjs';

const run = promisify(execFile);
const sample = 'public/rover.glb';
const baseline = 'public/rover-raised.glb';
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
  assert.deepEqual(sampleData.identity, { assetId: 'modelcheck:rover', revision: 'v2' });

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
  const canvas = page.locator('#stage canvas');
  const initialFrame = await canvas.screenshot();
  await page.getByRole('button', { name: 'Auto orbit' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#turntable').getAttribute('aria-pressed'), 'true');
  assert.notDeepEqual(await canvas.screenshot(), initialFrame);
  await page.getByRole('button', { name: 'Fly', exact: true }).click();
  assert.equal(await page.locator('#stage').getAttribute('data-navigation'), 'fly');
  assert.equal(await page.locator('#turntable').getAttribute('aria-pressed'), 'false');
  assert(await page.getByLabel('Fly speed').isVisible());
  await page.getByLabel('Fly speed').selectOption('3');
  assert(await canvas.evaluate((element) => document.activeElement === element));
  const flyStart = await canvas.screenshot();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyW');
  assert.notDeepEqual(await canvas.screenshot(), flyStart);
  const beforeLook = await canvas.screenshot();
  const area = await canvas.boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + 80, area.y + area.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  assert.notDeepEqual(await canvas.screenshot(), beforeLook);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#stage').getAttribute('data-navigation'), 'orbit');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Prepare agent task' }).click();
  const handoff = page.getByRole('dialog', { name: 'Prepare agent task' });
  const task = handoff.getByLabel('Task preview');
  assert.match(await task.inputValue(), /public\/rover\.glb.*--baseline.*public\/rover-raised\.glb/);
  await handoff.getByLabel('What should it check?', { exact: false }).fill('Check wheel clearance');
  assert.match(await task.inputValue(), /Review target: Check wheel clearance/);
  await handoff.getByLabel('Current GLB path').fill("models/Rover's $body.glb");
  assert((await task.inputValue()).includes("'models/Rover''s $body.glb'"));
  await handoff.getByLabel('Shell', { exact: true }).selectOption('bash');
  assert((await task.inputValue()).includes("'models/Rover'\\''s $body.glb'"));
  await handoff.getByRole('button', { name: 'Copy agent task' }).click();
  await handoff.getByText('Agent task copied.').waitFor();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard.replaceAll('\r\n', '\n'), await task.inputValue());
  await handoff.getByRole('button', { name: 'Close agent task' }).click();
  const guideUrl = new URL(await page.locator('#python-guide').getAttribute('href'), page.url());
  assert((await page.request.get(guideUrl.href)).ok());

  await page.getByRole('button', { name: 'Compare versions' }).click();
  const comparisonDialog = page.getByRole('dialog', { name: 'Compare versions' });
  const comparisonImage = comparisonDialog.locator('#comparison-image');
  const sheetReady = () => page.waitForFunction(() => document.querySelector('#comparison-image').naturalHeight === 1624);
  await sheetReady();
  assert.match(await comparisonDialog.locator('#comparison-identity').textContent(), /Matching model IDs.*v1.*v2/);
  assert.equal(await comparisonDialog.getByLabel('Baseline', { exact: true }).inputValue(), '1');
  await comparisonDialog.getByLabel('View', { exact: true }).selectOption('right');
  await page.waitForFunction(() => document.querySelector('#comparison-image').naturalHeight === 460);
  const [comparisonDownload] = await Promise.all([
    page.waitForEvent('download'), comparisonDialog.getByRole('button', { name: 'Download comparison PNG' }).click(),
  ]);
  const comparedPng = await readFile(await comparisonDownload.path());
  assert.equal(comparisonDownload.suggestedFilename(), 'rover-comparison.png');
  assert.deepEqual(sizeOfPng(comparedPng), [1200, 460]);
  const [changesDownload] = await Promise.all([
    page.waitForEvent('download'), comparisonDialog.getByRole('button', { name: 'Download changes JSON' }).click(),
  ]);
  const compared = JSON.parse(await readFile(await changesDownload.path(), 'utf8'));
  assert.deepEqual(compared.candidate, sampleData);
  assert.equal(compared.baseline.name, 'rover-raised.glb');
  assert.equal(compared.framing, 'shared-glb-coordinates');
  assert.equal(compared.identityStatus, 'matching-id');
  assert.deepEqual(compared.delta.bounds.size, [0, 0, 0]);

  await page.locator('#baseline-file').setInputFiles({
    name: 'bad-baseline.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('invalid'),
  });
  await page.waitForFunction(() => document.querySelector('#comparison-status').textContent.includes('too small'));
  assert(await comparisonDialog.getByRole('button', { name: 'Download comparison PNG' }).isDisabled());
  const sourceBaseline = await readFile(baseline);
  for (const [from, to, status] of [
    ['modelcheck:rover', 'modelcheck:other', 'different-ids'],
    ['"modelcheck":', '"legacyflag":', 'unrecorded'],
  ]) {
    const changed = Buffer.from(sourceBaseline);
    const start = changed.indexOf(from);
    assert(start >= 0 && from.length === to.length);
    changed.write(to, start);
    await page.locator('#baseline-file').setInputFiles({
      name: 'custom-baseline.glb', mimeType: 'model/gltf-binary', buffer: changed,
    });
    await comparisonDialog.locator(`#comparison-identity[data-identity="${status}"]:visible`).waitFor();
    await comparisonImage.waitFor({ state: 'visible' });
  }
  await page.locator('#baseline-file').setInputFiles(baseline);
  await comparisonImage.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await comparisonDialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.modelCheck.report()), sampleData);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (process.env.MODELCHECK_MOBILE_SCREENSHOT) {
    await page.screenshot({ path: process.env.MODELCHECK_MOBILE_SCREENSHOT, fullPage: true });
  }
  await page.getByRole('button', { name: 'Compare versions' }).click();
  await sheetReady();
  assert(await comparisonDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth));
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
  const comparisonOutput = join(temp, 'compare.png');
  const cliComparison = JSON.parse((await run(process.execPath, [
    'scripts/inspect.mjs', sample, '--baseline', baseline, '--view', 'right', '--out', comparisonOutput,
  ])).stdout);
  const comparisonReport = JSON.parse(await readFile(cliComparison.report, 'utf8'));
  assert.deepEqual(comparisonReport.delta, compared.delta);
  assert.equal(comparisonReport.framing, compared.framing);
  assert.equal(comparisonReport.identityStatus, compared.identityStatus);
  assert.match(comparisonReport.baseline.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(comparisonReport.baseline.sha256, comparisonReport.model.sha256);
  assert.deepEqual(await readFile(comparisonOutput), comparedPng);
  await assert.rejects(run(process.execPath, ['scripts/inspect.mjs', sample, '--size', '399']), /size must/);
  console.log('Passed: camera modes, agent handoff, revision identity, browser and CLI capture parity, recovery, library, and mobile layout.');
} finally {
  try { await browser?.close(); } finally {
    try { await site?.close(); } finally { await rm(temp, { recursive: true, force: true }); }
  }
}
