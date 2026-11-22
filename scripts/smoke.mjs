import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { launchBrowser, startSite } from './local-browser.mjs';

const run = promisify(execFile);
const sample = 'public/rover.glb';
const baseline = 'public/rover-raised.glb';
const motion = 'public/rover-motion.glb';
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

  const png = async (view) => Buffer.from(await page.evaluate(async (view) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const image = await window.modelCheck.capture({ view, size: 480 });
    return Array.from(new Uint8Array(await image.arrayBuffer()));
  }, view));
  // Native current-view rendering can shift by subpixels across frames.
  const difference = (first, second) => page.evaluate(async (images) => {
    const pixels = await Promise.all(images.map(async (encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }));
    if (pixels[0].length !== pixels[1].length) return Infinity;
    let total = 0;
    for (let i = 0; i < pixels[0].length; i++) total += Math.abs(pixels[0][i] - pixels[1][i]);
    return total / pixels[0].length;
  }, [first.toString('base64'), second.toString('base64')]);
  await page.getByRole('button', { name: 'Toggle grid' }).click();
  const intact = await png('current');
  const canonical = await png('sheet');
  await page.getByRole('button', { name: 'Section', exact: true }).click();
  await page.getByLabel('Section axis').selectOption('1');
  assert.match(await page.locator('#section-value').textContent(), /^Y = /);
  const section = await png('current');
  const cutDifference = await difference(intact, section);
  assert(cutDifference > .5, `The cut should visibly change the current capture (${cutDifference}).`);
  assert((await png('sheet')).equals(canonical), 'A section must not affect the review sheet.');
  await page.getByRole('button', { name: 'Flip side' }).click();
  assert(!(await png('current')).equals(section), 'Flipping the section should show the other side.');
  await page.getByRole('button', { name: 'Section', exact: true }).click();
  assert.equal(await page.locator('#section').getAttribute('aria-pressed'), 'false');
  const restoredSectionDifference = await difference(intact, await png('current'));
  assert(restoredSectionDifference < cutDifference / 2,
    `Closing Section should bring back the full model (${restoredSectionDifference} versus ${cutDifference}).`);

  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await canvas.click({ position: { x: area.width * .46, y: area.height * .51 } });
  const pinDialog = page.getByRole('dialog', { name: 'Add a review pin' });
  const pinText = '<b>Check the front panel fit.</b>';
  await pinDialog.getByLabel('Note').fill(pinText);
  await pinDialog.getByRole('button', { name: 'Save pin', exact: true }).click();
  await page.getByRole('button', { name: 'Focus pin 1' }).waitFor();
  assert.equal(await page.locator('#pin-list').textContent(), `1. ${pinText}×`);
  assert.equal(await page.locator('#pin-list b').count(), 0);
  const [pinDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Save pins' }).click(),
  ]);
  const pinsPath = join(temp, 'rover-pins.json');
  await pinDownload.saveAs(pinsPath);
  const pinFile = JSON.parse(await readFile(pinsPath, 'utf8'));
  assert.equal(pinFile.modelSha256, createHash('sha256').update(await readFile(sample)).digest('hex'));
  assert.equal(pinFile.pins[0].text, pinText);
  assert(pinFile.pins[0].position.every(Number.isFinite));
  await page.getByRole('button', { name: 'Remove pin 1' }).click();
  await page.locator('#pin-file').setInputFiles({
    name: 'mismatched-pins.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...pinFile, modelSha256: '0'.repeat(64) })),
  });
  await page.getByText('These pins belong to a different GLB file.', { exact: true }).waitFor();
  await page.locator('#pin-file').setInputFiles(pinsPath);
  await page.getByText('Pins loaded.', { exact: true }).waitFor();
  assert.equal(await page.locator('#pin-list li').count(), 1);

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

  await page.getByRole('button', { name: /rover-motion\.glb/ }).click();
  await ready();
  const timeline = page.getByLabel('Animation time');
  const clips = page.getByLabel('Animation clip');
  assert.deepEqual(await clips.locator('option').allTextContents(), ['Sensor sweep', 'Sensor tilt']);
  const rest = await png('current');
  const motionSheet = await png('sheet');
  await timeline.fill('0.7');
  assert.match(await page.locator('#animation-time').textContent(), /^0.70 /);
  const poseDifference = await difference(rest, await png('current'));
  assert(poseDifference > .1, `Scrubbing should visibly change the current capture (${poseDifference}).`);
  assert((await png('sheet')).equals(motionSheet), 'Animated poses must not affect the review sheet.');
  await page.getByRole('button', { name: 'Next step' }).click();
  assert.match(await page.locator('#animation-time').textContent(), /^0.73 /);
  await clips.selectOption('1');
  assert.equal(Number(await timeline.inputValue()), 0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => Number(document.getElementById('animation-position').value) > .1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Rest pose' }).click();
  const restoredPoseDifference = await difference(rest, await png('current'));
  assert(restoredPoseDifference < poseDifference / 2,
    `Rest pose should restore the original capture (${restoredPoseDifference} versus ${poseDifference}).`);
  if (process.env.MODELCHECK_INSPECTION_SCREENSHOT) {
    await timeline.fill('0.7');
    await page.getByRole('button', { name: 'Section', exact: true }).click();
    await page.screenshot({ path: process.env.MODELCHECK_INSPECTION_SCREENSHOT, fullPage: true });
  }
  await page.getByRole('button', { name: /^rover\.glb/ }).click();
  await ready();
  assert(await timeline.isHidden());
  assert(await page.locator('#section-tools').isHidden());
  assert.equal(await page.locator('#pin-list li').count(), 1);
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

  await page.goto(`${site.url}?sample=rally-paddle`);
  await ready();
  assert.equal(await page.locator('h1').textContent(), 'rally-paddle.glb');
  await page.getByRole('button', { name: 'Compare versions' }).click();
  await page.locator('#comparison-identity[data-identity="matching-id"]:visible').waitFor();
  assert.match(await page.locator('#comparison-identity').textContent(), /v1.*v2/);
  await page.getByLabel('View', { exact: true }).selectOption('bottom');
  await page.waitForFunction(() => document.querySelector('#comparison-image').naturalHeight === 460);
  await page.keyboard.press('Escape');
  assert.deepEqual(pageErrors, []);

  const output = join(temp, 'review space', 'model.png');
  const { stdout } = await run(process.execPath, ['scripts/inspect.mjs', sample, '--out', output]);
  const response = JSON.parse(stdout);
  assert.equal(response.png, output);
  const report = JSON.parse(await readFile(response.report, 'utf8'));
  assert.equal(report.model.triangles, sampleData.triangles);
  assert.equal(report.capture.width, 1200);
  assert.deepEqual(await readFile(output), browserPng);
  const back = join(temp, 'back.png');
  const backCapture = JSON.parse((await run(process.execPath, [
    'scripts/inspect.mjs', 'public/rally-paddle.glb', '--out', back, '--view', 'back', '--size', '640',
  ])).stdout);
  assert.equal(backCapture.view, 'back');
  assert.deepEqual(sizeOfPng(await readFile(back)), [640, 457]);
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
    'scripts/share.mjs', sample, '--baseline', baseline, '--pins', pinsPath, '--dir', temp,
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
  assert.equal(await shared.locator('#pin-list .pin-note').textContent(), `1. ${pinText}`);
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
  await assert.rejects(run(process.execPath, [
    'scripts/share.mjs', baseline, '--pins', pinsPath, '--static', '--dir', temp,
  ]), /different GLB file/);
  console.log('Passed: navigation, measurement, section, animation, pins, revision comparison, capture parity, and shared review.');
} finally {
  if (reviewServerPid) process.kill(reviewServerPid);
  try { await browser?.close(); } finally {
    try { await site?.close(); } finally { await rm(temp, { recursive: true, force: true }); }
  }
}
