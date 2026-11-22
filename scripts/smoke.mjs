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
let reviewServerPid;

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

  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const frontFrame = await canvas.screenshot();
  await canvas.dblclick({ position: { x: area.width * .55, y: area.height * .51 } });
  assert.notDeepEqual(await canvas.screenshot(), frontFrame);
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await canvas.click({ position: { x: area.width * .46, y: area.height * .51 } });
  assert.match(await page.locator('#measure-hint').textContent(), /second point/);
  await canvas.click({ position: { x: area.width * .55, y: area.height * .51 } });
  const measured = await page.locator('#measurement-distance').textContent();
  assert.match(measured, /model units$/);
  assert(Number(measured.split(' ')[0]) > 0 && Number(measured.split(' ')[0]) < 2.85);
  await page.getByRole('button', { name: 'Clear measurement' }).click();
  assert(await page.locator('#measurement').isHidden());
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  assert(await page.locator('#measure-hint').isHidden());

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

  const share = JSON.parse((await run(process.execPath, [
    'scripts/share.mjs', sample, '--baseline', baseline, '--dir', temp,
    '--title', 'Wheel check', '--note', '<b>Check rear-wheel alignment.</b>',
  ])).stdout);
  reviewServerPid = share.serverPid;
  assert.equal(share.scope, 'local');
  assert.match(share.url, /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.equal((await fetch(new URL('package.json', share.url))).status, 404);
  assert.deepEqual(await readFile(join(share.directory, 'current.glb')), await readFile(sample));
  const shared = await browser.newPage();
  await shared.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await shared.goto(share.url);
  await shared.locator('#state[data-phase="ready"]').waitFor();
  assert.equal(await shared.locator('#review-title').textContent(), 'Wheel check');
  assert.equal(await shared.locator('#review-note').textContent(), '<b>Check rear-wheel alignment.</b>');
  assert.equal(await shared.locator('#review-note b').count(), 0);
  assert.deepEqual(await shared.evaluate(() => window.modelCheck.report()), sampleData);
  await shared.getByRole('button', { name: 'Copy review link' }).click();
  await shared.getByRole('button', { name: 'Link copied' }).waitFor();
  assert.equal(await shared.evaluate(() => navigator.clipboard.readText()), share.url);
  await shared.getByRole('button', { name: 'Compare versions' }).click();
  await shared.locator('#comparison-identity[data-identity="matching-id"]:visible').waitFor();
  await shared.locator('#comparison-image').waitFor({ state: 'visible' });
  await shared.close();

  const staticReview = JSON.parse((await run(process.execPath, [
    'scripts/share.mjs', sample, '--static', '--dir', temp,
  ])).stdout);
  assert.equal(staticReview.scope, 'static');
  assert.equal(staticReview.url, null);
  assert.match(await readFile(staticReview.entry, 'utf8'), /data-shared-review/);
  console.log('Passed: camera and measurement tools, revision identity, capture parity, and a share link opened in a fresh browser.');
} finally {
  if (reviewServerPid) process.kill(reviewServerPid);
  try { await browser?.close(); } finally {
    try { await site?.close(); } finally { await rm(temp, { recursive: true, force: true }); }
  }
}
