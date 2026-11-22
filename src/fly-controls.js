import { Euler, MathUtils, Vector3 } from 'three';

const MOVEMENT = new Map([
  ['KeyW', 'forward'], ['ArrowUp', 'forward'], ['KeyS', 'back'], ['ArrowDown', 'back'],
  ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right'],
  ['KeyE', 'up'], ['KeyQ', 'down'], ['ShiftLeft', 'boost'], ['ShiftRight', 'boost'],
]);

export class FlyControls {
  constructor(camera, canvas, onLook) {
    this.camera = camera;
    this.canvas = canvas;
    this.onLook = onLook;
    this.euler = new Euler(0, 0, 0, 'YXZ');
    this.keys = new Set();
    this.touch = new Set();
    this.movement = new Vector3();
    this.vertical = new Vector3();
    this.speed = 1;
    this.enabled = false;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D viewport');
    canvas.addEventListener('keydown', (event) => {
      if (!this.enabled || !MOVEMENT.has(event.code) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    canvas.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled || this.pointer || event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.pointer?.id) return;
      this.euler.y -= (event.clientX - this.pointer.x) * .004;
      this.euler.x = MathUtils.clamp(this.euler.x - (event.clientY - this.pointer.y) * .004, -1.55, 1.55);
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.camera.quaternion.setFromEuler(this.euler);
      this.onLook();
    });
    canvas.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId === this.pointer?.id) this.pointer = null;
    });
  }

  setEnabled(enabled) {
    this.resetInput();
    this.enabled = enabled;
    if (enabled) this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
  }

  resetInput() {
    this.keys.clear();
    this.touch.clear();
    if (this.pointer && this.canvas.hasPointerCapture(this.pointer.id)) {
      this.canvas.releasePointerCapture(this.pointer.id);
    }
    this.pointer = null;
  }

  setTouch(direction, pressed) {
    if (pressed && this.enabled) this.touch.add(direction);
    else this.touch.delete(direction);
  }

  update(seconds) {
    if (!this.keys.size && !this.touch.size) return false;
    const active = new Set(this.touch);
    for (const key of this.keys) active.add(MOVEMENT.get(key));
    const axis = (positive, negative) => Number(active.has(positive)) - Number(active.has(negative));
    this.movement.set(axis('right', 'left'), 0, axis('back', 'forward')).applyQuaternion(this.camera.quaternion);
    this.movement.add(this.vertical.set(0, axis('up', 'down'), 0));
    if (!this.movement.lengthSq() || seconds === 0) return false;
    const distance = seconds * this.speed * (active.has('boost') ? 3 : 1);
    this.camera.position.addScaledVector(this.movement.normalize(), distance);
    return true;
  }
}
