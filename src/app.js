import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Camera, ChevronsDown, ChevronsUp,
  Columns2, FileJson, FilePlus2, FolderOpen, Grid, Layers, LayoutGrid, Link, MapPin, Navigation, RotateCw,
  Ruler, Scan, Search, ShieldCheck, SkipBack, SkipForward, Slice, X, createIcons,
} from 'lucide';
import { PinEditor, readPins } from './pin-editor.js';
import { Viewer, VIEWS } from './viewer.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const icons = {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Camera, ChevronsDown, ChevronsUp,
  Columns2, FileJson, FilePlus2, FolderOpen, Grid, Layers, LayoutGrid, Link, MapPin, Navigation, RotateCw,
  Ruler, Scan, Search, ShieldCheck, SkipBack, SkipForward, Slice, X,
};
const renderIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
renderIcons();

const stage = $('stage');
const automation = new URLSearchParams(location.search).has('automation');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const modelButtons = [...viewButtons, ...[
  'grid', 'wireframe', 'fit', 'sheet', 'compare', 'snapshot', 'report', 'fly', 'turntable', 'measure', 'section', 'pin',
].map($)];
const format = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 });
const countFormat = new Intl.NumberFormat('en');
let viewer;
let pinEditor;
let entries = [];
let activeEntry;
let report;
let ticket = 0;
let navigation = 'orbit';
let measuring = false;
let lastBaseline;
const comparisonDialog = $('comparison');
const deltaFormat = new Intl.NumberFormat('en', { maximumSignificantDigits: 4, signDisplay: 'exceptZero' });
let comparisonSession;
let comparisonImage;
let comparisonUrl;
let comparisonRequest = 0;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${format.format(bytes / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

function entryForFile(file) {
  return {
    name: file.name, path: file.webkitRelativePath || file.name,
    detail: formatBytes(file.size), read: () => file.arrayBuffer(),
  };
}

function staticEntry(name, detail, file = name) {
  return {
    name, path: name, detail,
    async read() {
      const response = await fetch(`${import.meta.env.BASE_URL}${file}`);
      if (!response.ok) throw new Error('This model file could not be loaded.');
      return response.arrayBuffer();
    },
  };
}

function setModelPair(current, baseline, additional = []) {
  current.baseline = baseline;
  if (baseline) baseline.baseline = current;
  entries = baseline ? [current, baseline, ...additional] : [current, ...additional];
  return select(current);
}

async function openSharedReview() {
  const version = ticket;
  const response = await fetch(`${import.meta.env.BASE_URL}review.json`);
  if (!response.ok) throw new Error('The review manifest could not be loaded.');
  const review = await response.json();
  if (version !== ticket) return;
  if (review.version !== 1 || typeof review.current !== 'string' || !/\.glb$/i.test(review.current)) {
    throw new Error('This review has an invalid manifest.');
  }
  const title = typeof review.title === 'string' && review.title.trim() ? review.title : 'Shared review';
  document.title = `${title} — ModelCheck`;
  $('review-title').textContent = title;
  const note = typeof review.note === 'string' ? review.note : '';
  $('review-note').textContent = note;
  $('review-note').hidden = !note;
  const current = staticEntry(review.current, 'Current model', 'current.glb');
  const baseline = typeof review.baseline === 'string' && /\.glb$/i.test(review.baseline)
    ? staticEntry(review.baseline, 'Baseline', 'baseline.glb') : null;
  current.shared = true;
  current.sharedPins = review.pins;
  if (baseline) baseline.shared = true;
  await setModelPair(current, baseline);
}

function state(phase, error = '') {
  $('state').textContent = phase;
  $('state').dataset.phase = phase.toLowerCase();
  $('state').toggleAttribute('data-error', Boolean(error));
  $('stage-message').hidden = !error;
  $('stage-message').textContent = error;
  for (const button of modelButtons) button.disabled = phase !== 'Ready';
}

function updateNavigation(mode) {
  if (navigation === mode) return;
  if (mode !== 'orbit') {
    pinEditor.cancel();
    setMeasuring(false);
  }
  navigation = mode;
  viewer.setNavigation(mode);
  stage.dataset.navigation = mode;
  $('turntable').setAttribute('aria-pressed', String(mode === 'turntable'));
  $('fly').setAttribute('aria-pressed', String(mode === 'fly'));
  $('fly-hud').hidden = mode !== 'fly';
  $('speed-control').hidden = mode !== 'fly';
  updateOrbitHint();
  if (mode !== 'orbit') setActiveView('');
}

function updateMeasureHint(distance) {
  $('measure-hint').textContent = distance == null ? 'Select the second point' : 'Select a point to start a new measurement';
  $('measurement').hidden = distance == null;
  $('measurement-distance').textContent = distance == null ? '' : `${format.format(distance)} model units`;
}

function setMeasuring(active) {
  if (active) {
    pinEditor.cancel();
    viewer.inspection.playing = false;
    updateAnimation();
  }
  measuring = active;
  $('measure').setAttribute('aria-pressed', String(active));
  stage.toggleAttribute('data-measuring', active);
  $('measure-hint').hidden = !active;
  updateOrbitHint();
  clearMeasurement();
  if (active) stage.querySelector('canvas').focus({ preventScroll: true });
}

function clearMeasurement() {
  viewer.clearMeasurement();
  $('measure-hint').textContent = 'Select the first point on the model';
  $('measurement').hidden = true;
  $('measurement-distance').textContent = '';
}

function updateOrbitHint() {
  $('orbit-hint').hidden = measuring || pinEditor?.armed || navigation === 'fly';
}

function pickSurface(x, y) {
  if (pinEditor.armed) return pinEditor.pick(x, y);
  const result = viewer.measureAt(x, y);
  if (result) updateMeasureHint(result.distance);
}

function setSection(enabled) {
  $('section').setAttribute('aria-pressed', String(enabled));
  $('section-tools').hidden = !enabled;
  if (enabled) updateSection();
  else {
    viewer.inspection.removeSection();
    viewer.render();
  }
}

function updateSection() {
  const axis = Number($('section-axis').value);
  const fraction = Number($('section-position').value) / 1000;
  const flipped = $('section-flip').getAttribute('aria-pressed') === 'true';
  viewer.inspection.setSection(axis, fraction, flipped, viewer.box);
  const min = viewer.originalBox.min.getComponent(axis);
  const max = viewer.originalBox.max.getComponent(axis);
  $('section-value').textContent = `${'XYZ'[axis]} = ${format.format(min + (max - min) * fraction)}`;
  clearMeasurement();
  viewer.render();
}

function updateAnimation() {
  const inspection = viewer.inspection;
  const clip = inspection.clips?.[Number($('animation-clip').value)];
  const time = inspection.time ?? 0;
  const duration = clip?.duration ?? 0;
  $('animation-position').max = duration;
  $('animation-position').value = time;
  $('animation-time').textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
  $('play-animation').textContent = inspection.playing ? 'Pause' : 'Play';
  $('rest-animation').disabled = !inspection.action;
}

function showAnimations(animations) {
  $('animation-clip').replaceChildren(...animations.map(({ name }, index) => new Option(name || `Clip ${index + 1}`, index)));
  $('animation-tools').hidden = !animations.length;
  updateAnimation();
}

function prepareAnimation() {
  pinEditor.cancel();
  setMeasuring(false);
  const inspection = viewer.inspection;
  if (!inspection.action) inspection.chooseClip(Number($('animation-clip').value));
  return inspection;
}

function clearInspection() {
  pinEditor.setEntry(undefined);
  viewer.inspection.stop();
  showAnimations([]);
  setSection(false);
  $('section-axis').value = '0';
  $('section-position').value = '500';
  $('section-flip').setAttribute('aria-pressed', 'false');
}

function setActiveView(view) {
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
}

function showStats() {
  $('stats').replaceChildren();
  const revision = $('revision-label');
  revision.hidden = !report?.identity;
  revision.textContent = report?.identity ? identityLabel(report.identity) : '';
  if (!report) return;
  const rows = [
    ['File size', formatBytes(report.bytes)], ['Meshes', countFormat.format(report.meshes)],
    ['Triangles', countFormat.format(report.triangles)], ['Vertices', countFormat.format(report.vertices)],
    ['Materials', countFormat.format(report.materials)], ['Animations', countFormat.format(report.animations.length)],
    ['Bounds XYZ', report.bounds.size.map((axis) => format.format(axis)).join(' × ')],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'stat';
    const title = document.createElement('dt');
    title.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    row.append(title, detail);
    $('stats').append(row);
  }
}

function identityLabel(identity) {
  return [identity.assetId, identity.revision].filter(Boolean).join(' / ');
}

function renderLibrary() {
  const term = $('search').value.trim().toLowerCase();
  const visible = entries.filter((entry) => entry.path.toLowerCase().includes(term));
  $('count').textContent = countFormat.format(entries.length);
  $('models').replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-list';
    empty.textContent = entries.length ? 'No matching models.' : 'No GLB files selected.';
    $('models').append(empty);
  }
  for (const entry of visible) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'model-item';
    button.title = entry.path;
    if (activeEntry === entry) {
      button.classList.add('selected');
      button.setAttribute('aria-current', 'true');
    }
    const icon = document.createElement('i');
    icon.dataset.lucide = 'box';
    const text = document.createElement('span');
    text.className = 'model-text';
    const title = document.createElement('span');
    title.textContent = entry.name;
    const detail = document.createElement('small');
    detail.textContent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : entry.detail;
    text.append(title, detail);
    button.append(icon, text);
    button.addEventListener('click', () => {
      select(entry);
      [...$('models').querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-current'))?.focus();
    });
    item.append(button);
    $('models').append(item);
  }
  renderIcons();
}

async function select(entry) {
  const version = ++ticket;
  activeEntry = entry;
  $('review-context').hidden = !entry.shared;
  $('copy-review-link').hidden = !entry.shared;
  setMeasuring(false);
  clearInspection();
  lastBaseline = undefined;
  updateNavigation('orbit');
  report = null;
  $('model-title').textContent = entry.name;
  state('Loading');
  showStats();
  renderLibrary();
  try {
    const buffer = await entry.read();
    if (version !== ticket) return null;
    const result = await viewer.load(buffer, entry.name);
    if (version !== ticket || !result) return null;
    let pinError;
    if (entry.sharedPins !== undefined) {
      try {
        entry.pins = await readPins(entry, entry.sharedPins, buffer);
        delete entry.sharedPins;
      } catch (error) {
        pinError = error.message;
      }
    }
    if (version !== ticket) return null;
    report = result;
    pinEditor.setEntry(entry);
    if (pinError) pinEditor.status.textContent = pinError;
    showAnimations(report.animations);
    showStats();
    $('wireframe').setAttribute('aria-pressed', 'false');
    setActiveView('iso');
    state('Ready');
    return result;
  } catch (error) {
    if (version === ticket) state('Error', error.message || 'Unable to open this model.');
    return null;
  }
}

function importFiles(files, replace) {
  if (!viewer) return;
  const models = [...files].filter((file) => /\.glb$/i.test(file.name))
    .map(entryForFile).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (!models.length) {
    if (files.length) {
      ++ticket;
      activeEntry = undefined;
      $('review-context').hidden = true;
      $('copy-review-link').hidden = true;
      setMeasuring(false);
      clearInspection();
      lastBaseline = undefined;
      updateNavigation('orbit');
      report = null;
      $('model-title').textContent = 'No GLB files found';
      showStats();
      renderLibrary();
      state('Error', 'Choose a .glb file or a folder that contains GLB files.');
    }
    return;
  }
  const combined = new Map((replace ? [] : entries).map((entry) => [entry.path, entry]));
  for (const model of models) combined.set(model.path, model);
  entries = [...combined.values()];
  $('search').value = '';
  return select(models[0]);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadJson(data, name) {
  download(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }), name);
}

function clearComparisonImage() {
  comparisonImage = undefined;
  $('comparison-image').hidden = true;
  $('comparison-image').removeAttribute('src');
  $('save-comparison').disabled = true;
  $('save-comparison-json').disabled = true;
  if (comparisonUrl) URL.revokeObjectURL(comparisonUrl);
  comparisonUrl = undefined;
}

function showComparisonChanges(delta) {
  const panel = $('comparison-changes');
  panel.replaceChildren();
  panel.hidden = !delta;
  if (!delta) return;
  const sign = delta.bytes > 0 ? '+' : delta.bytes < 0 ? '−' : '';
  for (const value of [
    `Δ File size ${sign}${formatBytes(Math.abs(delta.bytes))}`,
    `Δ Triangles ${deltaFormat.format(delta.triangles)}`,
    `Δ Meshes ${deltaFormat.format(delta.meshes)}`,
    `Δ Bounds XYZ ${delta.bounds.size.map((value) => deltaFormat.format(value)).join(' × ')}`,
  ]) {
    const summary = document.createElement('span');
    summary.textContent = value;
    panel.append(summary);
  }
}

function showComparisonIdentity(comparison) {
  const panel = $('comparison-identity');
  panel.hidden = !comparison;
  if (!comparison) return;
  const { baseline, candidate, identityStatus } = comparison;
  panel.dataset.identity = identityStatus;
  const left = baseline.identity ? identityLabel(baseline.identity) : 'no model ID';
  const right = candidate.identity ? identityLabel(candidate.identity) : 'no model ID';
  const status = {
    'matching-id': 'Matching model IDs',
    'different-ids': 'Different model IDs',
    unrecorded: 'Manual pairing',
  }[identityStatus];
  panel.textContent = `${status} · Baseline ${left} · Current ${right}`;
}

function checkCaptureOptions(view, size, allowCurrent = false) {
  if (!['sheet', ...Object.keys(VIEWS)].includes(view) && !(allowCurrent && view === 'current')) {
    throw new Error('Unknown camera view.');
  }
  if (!Number.isInteger(size) || size < 480 || size > 2400) throw new Error('Size must be 480–2400 pixels.');
}

async function prepareComparison(entry) {
  if (!report) throw new Error('No model is ready.');
  const version = ticket;
  const buffer = await entry.read();
  if (version !== ticket) throw new Error('Model selection changed. Start the comparison again.');
  return viewer.prepareComparison(buffer, entry.name);
}

async function renderComparison() {
  const request = ++comparisonRequest;
  clearComparisonImage();
  $('comparison-status').textContent = 'Rendering comparison…';
  try {
    const result = await comparisonSession.capture({ view: $('comparison-view').value, size: 1200 });
    if (request !== comparisonRequest || !comparisonDialog.open) return;
    comparisonImage = result;
    comparisonUrl = URL.createObjectURL(result);
    $('comparison-image').src = comparisonUrl;
    $('comparison-image').hidden = false;
    $('comparison-status').textContent = '';
    $('save-comparison').disabled = false;
    $('save-comparison-json').disabled = false;
  } catch (error) {
    if (request === comparisonRequest && comparisonDialog.open) $('comparison-status').textContent = error.message;
  }
}

async function loadComparisonBaseline(entry) {
  const request = ++comparisonRequest;
  comparisonSession?.dispose();
  comparisonSession = undefined;
  clearComparisonImage();
  showComparisonChanges();
  showComparisonIdentity();
  $('comparison-status').textContent = entry ? 'Reading baseline…' : 'Pick a baseline from the library or choose a GLB file.';
  if (!entry) {
    lastBaseline = undefined;
    return;
  }
  try {
    const session = await prepareComparison(entry);
    if (request !== comparisonRequest || !comparisonDialog.open) {
      session.dispose();
      return;
    }
    comparisonSession = session;
    lastBaseline = entry;
    showComparisonChanges(session.report.delta);
    showComparisonIdentity(session.report);
    await renderComparison();
  } catch (error) {
    if (request === comparisonRequest && comparisonDialog.open) $('comparison-status').textContent = error.message;
  }
}

const stem = () => activeEntry.name.replace(/\.glb$/i, '');
async function exportView(view, button) {
  const name = activeEntry.name;
  const filename = `${stem()}-${view === 'sheet' ? 'review' : view}.png`;
  const version = ticket;
  button.disabled = true;
  try {
    download(await viewer.capture({ view, name }), filename);
    if (ticket === version) $('state').textContent = 'PNG saved';
  } catch (error) {
    if (ticket === version) $('state').textContent = error.message;
  } finally {
    if (ticket === version) button.disabled = false;
  }
}

$('open-files').addEventListener('click', () => $('files').click());
$('open-folder').addEventListener('click', () => $('folder').click());
for (const id of ['files', 'folder']) {
  $(id).addEventListener('change', (event) => {
    importFiles(event.target.files, id === 'folder');
    event.target.value = '';
  });
}
$('search').addEventListener('input', renderLibrary);
$('sheet').addEventListener('click', () => exportView('sheet', $('sheet')));
$('snapshot').addEventListener('click', () => exportView('current', $('snapshot')));
$('report').addEventListener('click', () => downloadJson(report, `${stem()}.json`));
$('compare').addEventListener('click', () => {
  const options = $('baseline-options');
  options.replaceChildren(new Option('Select a model from the library', ''));
  entries.forEach((entry, index) => {
    if (entry !== activeEntry) options.add(new Option(entry.path, String(index)));
  });
  $('comparison-view').value = 'sheet';
  comparisonDialog.showModal();
  const baseline = lastBaseline || activeEntry.baseline;
  const baselineIndex = entries.indexOf(baseline);
  options.value = baselineIndex >= 0 ? String(baselineIndex) : '';
  if (baseline && baselineIndex < 0) {
    options.add(new Option(baseline.path, 'external', false, true));
  }
  loadComparisonBaseline(baseline);
});
$('baseline-options').addEventListener('change', (event) => {
  const index = event.target.value;
  loadComparisonBaseline(index === 'external' ? lastBaseline : entries[Number(index || -1)]);
});
$('open-baseline').addEventListener('click', () => {
  $('baseline-file').value = '';
  $('baseline-file').click();
});
$('baseline-file').addEventListener('change', (event) => {
  if (!comparisonDialog.open || !event.target.files.length) return;
  $('baseline-options').value = '';
  loadComparisonBaseline(entryForFile(event.target.files[0]));
});
$('comparison-view').addEventListener('change', () => {
  if (comparisonSession) renderComparison();
});
$('save-comparison').addEventListener('click', () => download(comparisonImage, `${stem()}-comparison.png`));
$('save-comparison-json').addEventListener('click', () => {
  downloadJson(comparisonSession.report, `${stem()}-comparison.json`);
});
comparisonDialog.addEventListener('close', () => {
  ++comparisonRequest;
  clearComparisonImage();
  comparisonSession?.dispose();
  comparisonSession = undefined;
  $('baseline-file').value = '';
});
for (const button of viewButtons) {
  button.addEventListener('click', () => {
    updateNavigation('orbit');
    viewer.setView(button.dataset.view);
    setActiveView(button.dataset.view);
  });
}
viewerControls();
function viewerControls() {
  $('fit').addEventListener('click', () => {
    updateNavigation('orbit');
    viewer.fit();
  });
  $('turntable').addEventListener('click', () => updateNavigation(navigation === 'turntable' ? 'orbit' : 'turntable'));
  $('fly').addEventListener('click', () => updateNavigation(navigation === 'fly' ? 'orbit' : 'fly'));
  $('measure').addEventListener('click', () => {
    updateNavigation('orbit');
    setMeasuring(!measuring);
  });
  $('clear-measurement').addEventListener('click', clearMeasurement);
  $('section').addEventListener('click', () => setSection($('section-tools').hidden));
  $('section-axis').addEventListener('change', updateSection);
  $('section-position').addEventListener('input', updateSection);
  $('section-flip').addEventListener('click', (event) => {
    event.currentTarget.setAttribute('aria-pressed', String(event.currentTarget.getAttribute('aria-pressed') !== 'true'));
    updateSection();
  });
  $('animation-clip').addEventListener('change', () => {
    prepareAnimation().chooseClip(Number($('animation-clip').value));
    updateAnimation();
    viewer.render();
  });
  $('play-animation').addEventListener('click', () => {
    const inspection = prepareAnimation();
    if (inspection.time >= inspection.action.getClip().duration) inspection.seek(0);
    inspection.playing = !inspection.playing;
    updateAnimation();
    viewer.render();
  });
  function seekAnimation(seconds) {
    const inspection = prepareAnimation();
    inspection.playing = false;
    inspection.seek(seconds);
    updateAnimation();
    viewer.render();
  }
  $('animation-position').addEventListener('input', (event) => seekAnimation(Number(event.target.value)));
  $('animation-back').addEventListener('click', () => seekAnimation(viewer.inspection.time - 1 / 30));
  $('animation-forward').addEventListener('click', () => seekAnimation(viewer.inspection.time + 1 / 30));
  $('animation-speed').addEventListener('change', (event) => { viewer.inspection.speed = Number(event.target.value); });
  $('animation-repeat').addEventListener('change', (event) => { viewer.inspection.repeat = event.target.checked; });
  $('rest-animation').addEventListener('click', () => {
    setMeasuring(false);
    viewer.inspection.stop();
    updateAnimation();
    viewer.render();
  });
  $('fly-speed').addEventListener('change', (event) => viewer.setFlySpeed(Number(event.target.value)));
  stage.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && pinEditor.armed) {
      event.preventDefault();
      pinEditor.cancel();
      $('pin').focus({ preventScroll: true });
    } else if (event.code === 'Escape' && measuring) {
      event.preventDefault();
      setMeasuring(false);
      $('measure').focus({ preventScroll: true });
    } else if (event.code === 'Escape' && navigation === 'fly') {
      event.preventDefault();
      updateNavigation('orbit');
      $('fly').focus({ preventScroll: true });
    } else if (event.code === 'Enter' && (measuring || pinEditor.armed) && event.target instanceof HTMLCanvasElement) {
      event.preventDefault();
      const area = event.target.getBoundingClientRect();
      pickSurface(area.left + area.width / 2, area.top + area.height / 2);
    }
  });
  const move = (direction, pressed) => viewer.fly.setTouch(direction, pressed);
  for (const button of document.querySelectorAll('[data-move]')) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      move(button.dataset.move, true);
    });
    button.addEventListener('lostpointercapture', () => move(button.dataset.move, false));
  }
  for (const [id, method] of [['grid', 'setGrid'], ['wireframe', 'setWireframe']]) {
    $(id).addEventListener('click', () => {
      const next = $(id).getAttribute('aria-pressed') !== 'true';
      $(id).setAttribute('aria-pressed', String(next));
      viewer[method](next);
    });
  }
  let start;
  stage.addEventListener('pointerdown', (event) => {
    if (!(measuring || pinEditor.armed) || event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  });
  stage.addEventListener('pointermove', (event) => {
    if (event.buttons && event.target instanceof HTMLCanvasElement) setActiveView('');
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
      start.dragged = true;
    }
  });
  stage.addEventListener('pointerup', (event) => {
    if (start?.id !== event.pointerId) return;
    if ((measuring || pinEditor.armed) && !start.dragged && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 5) {
      pickSurface(event.clientX, event.clientY);
    }
    start = undefined;
  });
  stage.addEventListener('pointercancel', () => { start = undefined; });
  stage.addEventListener('dblclick', (event) => {
    if (report && !measuring && !pinEditor.armed && navigation === 'orbit' && event.target instanceof HTMLCanvasElement
        && viewer.focusAt(event.clientX, event.clientY)) setActiveView('');
  });
}

$('copy-review-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    const label = $('copy-review-link').querySelector('span');
    label.textContent = 'Link copied';
    setTimeout(() => { label.textContent = 'Copy review link'; }, 2500);
  } catch {
    const link = $('review-link');
    link.value = location.href;
    link.hidden = false;
    link.select();
  }
});

window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  document.body.classList.remove('dragging');
  if (comparisonDialog.open) {
    if (!event.dataTransfer.files.length) return;
    $('baseline-options').value = '';
    loadComparisonBaseline(entryForFile(event.dataTransfer.files[0]));
  } else {
    importFiles(event.dataTransfer.files, false);
  }
});

try {
  viewer = new Viewer(stage);
  pinEditor = new PinEditor(viewer, {
    start() {
      updateNavigation('orbit');
      setMeasuring(false);
      viewer.inspection.stop();
      updateAnimation();
      viewer.render();
    },
    label(active) {
      stage.toggleAttribute('data-pinning', active);
      $('pin-hint').hidden = !active;
      updateOrbitHint();
    },
    focus(point) {
      pinEditor.cancel();
      updateNavigation('orbit');
      setMeasuring(false);
      viewer.inspection.stop();
      updateAnimation();
      if (!viewer.inspection.allows(point)) setSection(false);
      setActiveView('');
    },
    save: downloadJson,
  });
  viewer.onRender = () => pinEditor.update();
  viewer.onAnimationFrame = updateAnimation;
  window.modelCheck = Object.freeze({
    async open(file) {
      if (!(file instanceof File) || !/\.glb$/i.test(file.name)) throw new Error('Provide a .glb File.');
      const selection = importFiles([file], true);
      const pending = ticket;
      const result = await selection;
      if (pending !== ticket) throw new Error('Model selection changed.');
      if (!result) throw new Error($('stage-message').textContent);
      return structuredClone(result);
    },
    report: () => report && structuredClone(report),
    capture(options = {}) {
      const { view = 'sheet', size = 1200 } = options;
      if (!report) throw new Error('No model is ready.');
      checkCaptureOptions(view, size, true);
      return viewer.capture({ view, size, name: activeEntry.name });
    },
    async compare(file, { view = 'sheet', size = 1200 } = {}) {
      if (!(file instanceof File) || !/\.glb$/i.test(file.name)) throw new Error('Provide a baseline .glb File.');
      checkCaptureOptions(view, size);
      const comparison = await prepareComparison(entryForFile(file));
      try {
        return { image: await comparison.capture({ view, size }), ...structuredClone(comparison.report) };
      } finally {
        comparison.dispose();
      }
    },
  });
  if (automation) {
    $('model-title').textContent = 'Open a GLB';
    state('Idle');
  } else if (document.documentElement.hasAttribute('data-shared-review')) {
    openSharedReview().catch((error) => {
      $('model-title').textContent = 'Review unavailable';
      state('Error', error.message);
    });
  } else {
    setModelPair(staticEntry('rover.glb', 'Aligned wheels'), staticEntry('rover-raised.glb', 'Raised rear wheel'), [
      staticEntry('rover-motion.glb', 'Sensor sweep and tilt'),
    ]);
  }
} catch (error) {
  $('model-title').textContent = 'Renderer unavailable';
  state('Error', `WebGL 2 could not start. Try a browser with WebGL 2 enabled. ${error.message}`);
}
