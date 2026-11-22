import { PIN_LIMIT, validatePinFile } from './review-pins.js';

const $ = (id) => document.getElementById(id);

async function hashEntry(entry, buffer) {
  if (!entry.sha256) {
    if (!globalThis.crypto?.subtle) throw new Error('Open ModelCheck using HTTPS or localhost to match pins to your GLB.');
    const digest = await crypto.subtle.digest('SHA-256', buffer ?? await entry.read());
    entry.sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return entry.sha256;
}

export async function readPins(entry, data, buffer) {
  const document = validatePinFile(data);
  if (document.modelSha256 !== await hashEntry(entry, buffer)) throw new Error('These pins belong to a different GLB file.');
  return document.pins;
}

export class PinEditor {
  constructor(viewer, { start, label, focus, save }) {
    this.viewer = viewer;
    this.showHint = label;
    this.button = $('pin');
    this.layer = $('pin-layer');
    this.list = $('pin-list');
    this.dialog = $('pin-dialog');
    this.text = $('pin-text');
    this.status = $('pin-status');
    this.importInput = $('pin-file');
    this.markers = [];

    this.button.addEventListener('click', () => {
      if (this.armed) this.cancel();
      else if ((this.entry.pins?.length ?? 0) < PIN_LIMIT) {
        start();
        this.armed = true;
        this.button.setAttribute('aria-pressed', 'true');
        this.showHint(true);
        viewer.renderer.domElement.focus({ preventScroll: true });
      } else this.status.textContent = 'This model has reached the pin limit.';
    });
    this.dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.text.value.trim();
      if (!text || !this.pending) return;
      const pins = this.entry.pins ??= [];
      pins.push({ position: this.pending, text });
      this.render();
      this.dialog.close();
    });
    this.dialog.addEventListener('close', () => { this.pending = null; });
    $('cancel-pin').addEventListener('click', () => this.dialog.close());
    $('import-pins').addEventListener('click', () => this.importInput.click());
    this.importInput.addEventListener('change', async () => {
      const file = this.importInput.files[0];
      this.importInput.value = '';
      if (!file || !this.entry) return;
      const entry = this.entry;
      try {
        if (file.size > 512 * 1024) throw new Error('This pins file is too large.');
        const pins = await readPins(entry, JSON.parse(await file.text()));
        if (entry !== this.entry) return;
        const combined = new Map((entry.pins ?? []).concat(pins).map((pin) => [JSON.stringify([pin.position, pin.text]), pin]));
        if (combined.size > PIN_LIMIT) throw new Error(`This model can hold up to ${PIN_LIMIT} pins.`);
        entry.pins = [...combined.values()];
        this.render();
        this.status.textContent = 'Pins loaded.';
      } catch (error) {
        if (entry === this.entry) this.status.textContent = error.message;
      }
    });
    $('export-pins').addEventListener('click', async () => {
      const entry = this.entry;
      if (!entry?.pins?.length) return;
      try {
        const modelSha256 = await hashEntry(entry);
        if (entry !== this.entry) return;
        save({ version: 1, modelSha256, pins: entry.pins }, `${entry.name.replace(/\.glb$/i, '')}-pins.json`);
        this.status.textContent = 'Pins exported.';
      } catch (error) {
        if (entry === this.entry) this.status.textContent = error.message;
      }
    });
    this.focus = (pin) => {
      const point = viewer.modelPoint(pin.position);
      focus(point);
      viewer.focusPoint(point);
    };
  }

  setEntry(entry) {
    this.cancel();
    if (this.dialog.open) this.dialog.close();
    this.pending = null;
    this.entry = entry;
    this.status.textContent = '';
    $('pin-panel').hidden = !entry;
    this.render();
  }

  cancel() {
    this.armed = false;
    this.button.setAttribute('aria-pressed', 'false');
    this.showHint(false);
  }

  pick(x, y) {
    const position = this.viewer.pointInModel(x, y);
    if (!position) return;
    this.pending = position;
    this.cancel();
    this.text.value = '';
    this.dialog.showModal();
    this.text.focus();
  }

  render() {
    this.list.replaceChildren();
    this.layer.replaceChildren();
    this.markers = [];
    const pins = this.entry?.pins ?? [];
    $('export-pins').disabled = pins.length === 0;
    $('pin-empty').hidden = pins.length > 0;
    pins.forEach((pin, index) => {
      const marker = document.createElement('button');
      marker.className = 'review-pin';
      marker.textContent = String(index + 1);
      marker.setAttribute('aria-label', `Focus pin ${index + 1}`);
      marker.addEventListener('click', () => this.focus(pin));
      this.layer.append(marker);
      this.markers.push({ marker, position: pin.position });

      const item = document.createElement('li');
      const note = document.createElement('button');
      note.className = 'pin-note';
      note.textContent = `${index + 1}. ${pin.text}`;
      note.addEventListener('click', () => this.focus(pin));
      const remove = document.createElement('button');
      remove.className = 'pin-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove pin ${index + 1}`);
      remove.addEventListener('click', () => {
        pins.splice(index, 1);
        this.render();
        $('import-pins').focus({ preventScroll: true });
      });
      item.append(note, remove);
      this.list.append(item);
    });
    this.update();
  }

  update() {
    for (const { marker, position } of this.markers) {
      const point = !this.viewer.inspection.action && this.viewer.projectModelPoint(position);
      marker.hidden = !point;
      if (point) {
        marker.style.left = `${point[0]}%`;
        marker.style.top = `${point[1]}%`;
      }
    }
  }
}
