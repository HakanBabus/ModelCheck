import { Box, Camera, Columns2, Copy, FileJson, FilePlus2, FolderOpen, Grid, Layers, LayoutGrid, Scan, Search, ShieldCheck, SlidersHorizontal, Terminal, X, createIcons } from 'lucide';
import { Viewer, VIEWS } from './viewer.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const icons = { Box, Camera, Columns2, Copy, FileJson, FilePlus2, FolderOpen, Grid, Layers, LayoutGrid, Scan, Search, ShieldCheck, SlidersHorizontal, Terminal, X };
const renderIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
renderIcons();

const stage = $('stage');
const automation = new URLSearchParams(location.search).has('automation');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const modelButtons = [...viewButtons, $('grid'), $('wireframe'), $('fit'), $('sheet'), $('compare'), $('snapshot'), $('report')];
const format = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 });
const countFormat = new Intl.NumberFormat('en');
let viewer;
let entries = [];
let activeEntry;
let report;
let ticket = 0;
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

function bundledEntry(name, detail) {
  return {
    name, path: name, detail,
    async read() {
      const response = await fetch(`${import.meta.env.BASE_URL}${name}`);
      if (!response.ok) throw new Error('The built-in model could not be loaded.');
      return response.arrayBuffer();
    },
  };
}

function state(phase, error = '') {
  $('state').textContent = phase;
  $('state').dataset.phase = phase.toLowerCase();
  $('state').toggleAttribute('data-error', Boolean(error));
  $('stage-message').hidden = !error;
  $('stage-message').textContent = error;
  for (const button of modelButtons) button.disabled = phase !== 'Ready';
}

function setActiveView(view) {
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
}

function showStats() {
  $('stats').replaceChildren();
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
    report = result;
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
  $('comparison-status').textContent = entry ? 'Reading baseline…' : 'Pick a baseline from the library or choose a GLB file.';
  if (!entry) return;
  try {
    const session = await prepareComparison(entry);
    if (request !== comparisonRequest || !comparisonDialog.open) {
      session.dispose();
      return;
    }
    comparisonSession = session;
    showComparisonChanges(session.report.delta);
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
  // Skip the picker when there is only one other model.
  options.selectedIndex = options.length === 2 ? 1 : 0;
  loadComparisonBaseline(options.value === '' ? undefined : entries[Number(options.value)]);
});
$('baseline-options').addEventListener('change', (event) => {
  const index = event.target.value;
  loadComparisonBaseline(index === '' ? undefined : entries[Number(index)]);
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
    viewer.setView(button.dataset.view);
    setActiveView(button.dataset.view);
  });
}
viewerControls();
function viewerControls() {
  $('fit').addEventListener('click', () => viewer.fit());
  for (const [id, method] of [['grid', 'setGrid'], ['wireframe', 'setWireframe']]) {
    $(id).addEventListener('click', () => {
      const next = $(id).getAttribute('aria-pressed') !== 'true';
      $(id).setAttribute('aria-pressed', String(next));
      viewer[method](next);
    });
  }
  stage.addEventListener('pointermove', (event) => {
    if (event.buttons && event.target instanceof HTMLCanvasElement) setActiveView('');
  });
}
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('npm run inspect -- model.glb');
    $('copy-status').textContent = 'Copied';
  } catch {
    $('copy-status').textContent = 'Select the command to copy it.';
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
  } else {
    const demo = bundledEntry('rover.glb', 'Aligned wheels');
    entries = [demo, bundledEntry('rover-raised.glb', 'Raised rear wheel')];
    select(demo);
  }
} catch (error) {
  $('model-title').textContent = 'Renderer unavailable';
  state('Error', `WebGL 2 could not start. Try a browser with WebGL 2 enabled. ${error.message}`);
}
