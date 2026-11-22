import { AnimationMixer, DoubleSide, LoopOnce, MathUtils, Plane, Vector3 } from 'three';

export class Inspection {
  constructor(renderer) {
    this.renderer = renderer;
    this.plane = new Plane(new Vector3(1, 0, 0), 0);
    this.planes = [this.plane];
    this.materialSides = new Map();
    this.speed = 1;
    this.repeat = true;
  }

  load(root, clips) {
    if (this.mixer) {
      this.stop();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.removeSection();
    this.root = root;
    this.clips = clips;
    this.mixer = new AnimationMixer(root);
  }

  setSection(axis, fraction, flipped, bounds) {
    if (!this.materialSides.size) {
      this.root.traverse((node) => {
        for (const material of [node.material].flat().filter(Boolean)) {
          if (this.materialSides.has(material)) continue;
          this.materialSides.set(material, material.side);
          material.clippingPlanes = this.planes;
          material.side = DoubleSide;
          material.needsUpdate = true;
        }
      });
    }
    const coordinate = MathUtils.lerp(bounds.min.getComponent(axis), bounds.max.getComponent(axis), fraction);
    const sign = flipped ? -1 : 1;
    this.plane.normal.set(0, 0, 0).setComponent(axis, sign);
    this.plane.constant = -coordinate * sign;
    this.renderer.localClippingEnabled = true;
  }

  removeSection() {
    for (const [material, side] of this.materialSides) {
      material.clippingPlanes = null;
      material.side = side;
      material.needsUpdate = true;
    }
    this.materialSides.clear();
    this.renderer.localClippingEnabled = false;
  }

  allows(point) {
    return !this.materialSides.size || this.plane.distanceToPoint(point) >= -1e-7;
  }

  chooseClip(index) {
    this.stop();
    this.action = this.mixer.clipAction(this.clips[index]);
    this.action.setLoop(LoopOnce, 1);
    this.action.play();
    this.seek(0);
  }

  seek(seconds) {
    if (!this.action) return;
    this.time = MathUtils.clamp(seconds, 0, this.action.getClip().duration);
    this.action.time = this.time;
    this.action.paused = true;
    this.mixer.update(0);
  }

  tick(seconds) {
    if (!this.playing || !this.action || seconds <= 0) return false;
    const duration = this.action.getClip().duration;
    const next = this.time + seconds * this.speed;
    if (next >= duration && !this.repeat) this.playing = false;
    this.seek(this.repeat && duration > 0 ? next % duration : next);
    return true;
  }

  stop() {
    this.action?.stop();
    this.action = null;
    this.time = 0;
    this.playing = false;
  }

  withRestPose(draw) {
    const action = this.action;
    const time = this.time;
    const clipping = this.renderer.localClippingEnabled;
    this.renderer.localClippingEnabled = false;
    // Restore original material sides as well as the unclipped geometry for canonical exports.
    for (const [material, side] of this.materialSides) material.side = side;
    action?.stop();
    try {
      return draw();
    } finally {
      for (const material of this.materialSides.keys()) material.side = DoubleSide;
      this.renderer.localClippingEnabled = clipping;
      if (action) {
        action.play();
        this.seek(time);
      }
    }
  }
}
