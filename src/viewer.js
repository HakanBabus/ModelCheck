import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import dracoWrapper from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url';
import basisScript from 'three/addons/libs/basis/basis_transcoder.js?url';
import basisWasm from 'three/addons/libs/basis/basis_transcoder.wasm?url';

export const VIEWS = {
  iso: { label: '3/4', direction: [1, .7, 1.22], up: [0, 1, 0] },
  front: { label: 'Front (+Z)', direction: [0, 0, 1], up: [0, 1, 0] },
  right: { label: 'Right (+X)', direction: [1, 0, 0], up: [0, 1, 0] },
  top: { label: 'Top (+Y)', direction: [0, 1, 0], up: [0, 0, -1] },
};
const decoderUrls = new Map(Object.entries({
  'modelcheck-decoder/draco_wasm_wrapper.js': dracoWrapper,
  'modelcheck-decoder/draco_decoder.wasm': dracoWasm,
  'modelcheck-decoder/basis_transcoder.js': basisScript,
  'modelcheck-decoder/basis_transcoder.wasm': basisWasm,
}));
const BACKGROUND = '#222a2e';
const REVIEW_VIEWS = ['front', 'right', 'top', 'iso'];

function pngBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Unable to encode the review PNG.'));
  }, 'image/png'));
}

function comparisonDelta(baseline, candidate) {
  const counts = ['bytes', 'meshes', 'triangles', 'vertices', 'materials'];
  const delta = Object.fromEntries(counts.map((key) => [key, candidate[key] - baseline[key]]));
  delta.animations = candidate.animations.length - baseline.animations.length;
  delta.bounds = Object.fromEntries(['min', 'max', 'size'].map((key) => [
    key, candidate.bounds[key].map((value, axis) => value - baseline.bounds[key][axis]),
  ]));
  return delta;
}

function normalizeBounds(box) {
  const size = box.getSize(new THREE.Vector3());
  const scale = 3 / Math.max(size.x, size.y, size.z);
  const offset = box.min.clone().multiplyScalar(-scale).addScaledVector(size, -scale / 2);
  return { scale, offset };
}

function disposeModel(root) {
  const resources = new Set();
  const images = new Set();
  root.traverse((node) => {
    if (node.geometry) resources.add(node.geometry);
    for (const material of [node.material].flat().filter(Boolean)) {
      resources.add(material);
      for (const texture of Object.values(material).filter((value) => value?.isTexture)) {
        resources.add(texture);
        if (texture.image?.close) images.add(texture.image);
      }
    }
    if (node.skeleton) resources.add(node.skeleton);
  });
  for (const resource of resources) resource.dispose();
  for (const image of images) image.close();
}

function validateGLB(buffer) {
  if (buffer.byteLength < 20) throw new Error('This file is too small to be a GLB.');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) {
    throw new Error('Choose a GLB 2.0 file.');
  }
  const jsonSize = header.getUint32(12, true);
  if (header.getUint32(8, true) !== buffer.byteLength || jsonSize + 20 > buffer.byteLength
      || header.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('The GLB header or JSON chunk is invalid.');
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonSize)));
  for (const asset of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (asset.uri !== undefined && !String(asset.uri).startsWith('data:')) {
      throw new Error('Export a self-contained GLB with embedded buffers and textures.');
    }
  }
}

function describe(root, box, animations, name, bytes) {
  let meshes = 0;
  let triangles = 0;
  let vertices = 0;
  const materials = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    const copies = node.isInstancedMesh ? node.count : 1;
    meshes += copies;
    vertices += (node.geometry.attributes.position?.count ?? 0) * copies;
    const elements = node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0;
    triangles += Math.floor(elements / 3) * copies;
    for (const material of [node.material].flat()) materials.add(material);
  });
  return {
    name, bytes, meshes, triangles, vertices, materials: materials.size,
    animations: animations.map((clip) => ({ name: clip.name, duration: clip.duration })),
    bounds: { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() },
  };
}

export class Viewer {
  constructor(stage) {
    this.stage = stage;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setClearColor(BACKGROUND);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    stage.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const environment = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = generator.fromScene(environment, .04).texture;
    environment.dispose();
    generator.dispose();
    this.scene.environmentIntensity = .65;
    this.scene.add(new THREE.HemisphereLight(0xe9fff8, 0x75818c, 1.15));
    const key = new THREE.DirectionalLight(0xfff2df, 1.65);
    key.position.set(4, 7, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa4d5ff, 1.35);
    rim.position.set(-3, 4, -5);
    this.scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(36, 1, .001, 100);
    this.camera.position.set(3, 2, 4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());
    this.axes = [...stage.querySelectorAll('#axes span')];
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (decoderUrls.has(url)) return decoderUrls.get(url);
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      throw new Error('The model references an external resource.');
    });
    this.loader = new GLTFLoader(manager)
      .setMeshoptDecoder(MeshoptDecoder)
      .setDRACOLoader(new DRACOLoader(manager).setDecoderPath('modelcheck-decoder/'))
      .setKTX2Loader(new KTX2Loader(manager).setTranscoderPath('modelcheck-decoder/').detectSupport(this.renderer));
    new ResizeObserver(() => this.resize()).observe(stage);
    this.renderer.setAnimationLoop(() => this.controls.update());
  }

  resize() {
    const width = Math.max(1, this.stage.clientWidth);
    const height = Math.max(1, this.stage.clientHeight);
    const aspect = width / height;
    const oldAspect = this.camera.aspect;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.box && aspect < oldAspect) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      if (offset.length() < this.fitDistance()) offset.setLength(this.fitDistance());
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    }
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    const inverse = this.camera.quaternion.clone().invert();
    this.axes.forEach((axis, index) => {
      const direction = new THREE.Vector3().setComponent(index === 0 ? 1 : index === 1 ? 0 : 2, 1);
      direction.applyQuaternion(inverse);
      axis.style.transform = `translate(${direction.x * 17}px, ${-direction.y * 17}px)`;
      axis.style.zIndex = Math.round(20 + direction.z * 10);
      axis.style.opacity = String(.65 + .35 * Math.abs(direction.z));
    });
  }

  async readModel(buffer, name) {
    validateGLB(buffer);
    const result = await this.loader.parseAsync(buffer, '');
    const root = result.scene;
    const originalBox = new THREE.Box3().setFromObject(root, true);
    const size = originalBox.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    if (originalBox.isEmpty() || !Number.isFinite(span) || span <= 0) {
      disposeModel(root);
      throw new Error('The GLB has no visible geometry with finite dimensions.');
    }
    return { root, originalBox, metadata: describe(root, originalBox, result.animations, name, buffer.byteLength) };
  }

  async load(buffer, name) {
    const generation = this.generation = (this.generation ?? 0) + 1;
    const { root, originalBox, metadata } = await this.readModel(buffer, name);
    if (generation !== this.generation) {
      disposeModel(root);
      return null;
    }
    if (this.model) {
      this.model.removeFromParent();
      disposeModel(this.model);
    }
    if (this.grid) {
      this.grid.removeFromParent();
      this.grid.dispose();
    }
    this.model = new THREE.Group();
    this.model.add(root);
    const { scale, offset } = normalizeBounds(originalBox);
    this.model.scale.setScalar(scale);
    this.model.position.copy(offset);
    this.originalBox = originalBox;
    this.metadata = metadata;
    this.scene.add(this.model);
    this.box = new THREE.Box3().setFromObject(this.model, true);
    this.radius = this.box.getBoundingSphere(new THREE.Sphere()).radius;
    this.grid = new THREE.GridHelper(18, 42, 0x64787e, 0x404e53);
    this.grid.position.y = this.box.min.y - .012;
    this.grid.material.transparent = true;
    this.grid.material.opacity = .65;
    this.scene.add(this.grid);
    this.grid.visible = this.gridVisible !== false;
    this.setWireframe(false);
    this.setView('iso');
    return metadata;
  }

  fitDistance() {
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    return this.radius / Math.sin(Math.min(vertical, horizontal)) * 1.12;
  }

  setView(key) {
    if (!this.box) return;
    const view = VIEWS[key];
    const direction = new THREE.Vector3(...view.direction).normalize();
    this.controls.target.set(0, 0, 0);
    this.controls.maxDistance = Math.max(24, this.fitDistance() * 4);
    this.controls.minDistance = .08;
    this.camera.position.copy(direction.multiplyScalar(this.fitDistance()));
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.render();
  }

  fit() {
    if (!this.box) return;
    const direction = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(direction.setLength(this.fitDistance()));
    this.controls.update();
    this.render();
  }

  setGrid(visible) {
    this.gridVisible = visible;
    if (this.grid) this.grid.visible = visible;
    this.render();
  }

  setWireframe(enabled) {
    this.model?.traverse((node) => {
      if (!node.isMesh) return;
      for (const material of [node.material].flat()) material.wireframe = enabled;
    });
    this.render();
  }

  reviewCamera(key, aspect, box = this.box) {
    const view = VIEWS[key];
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 40);
    camera.up.set(...view.up);
    camera.position.set(...view.direction).setLength(10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    let halfHeight = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const projected = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          halfHeight = Math.max(halfHeight, Math.abs(projected.x) / aspect, Math.abs(projected.y));
        }
      }
    }
    halfHeight *= 1.20;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    return camera;
  }

  renderCapture({ clean, draw }) {
    const rendererSize = this.renderer.getSize(new THREE.Vector2());
    const pixelRatio = this.renderer.getPixelRatio();
    const gridVisible = this.grid.visible;
    const materialModes = new Map();
    if (clean) {
      this.model.traverse((node) => {
        if (!node.isMesh) return;
        for (const material of [node.material].flat()) materialModes.set(material, material.wireframe);
      });
      for (const material of materialModes.keys()) material.wireframe = false;
      this.grid.visible = false;
    }
    try {
      this.renderer.setPixelRatio(1);
      return draw();
    } finally {
      for (const [material, wireframe] of materialModes) material.wireframe = wireframe;
      this.grid.visible = gridVisible;
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(rendererSize.x, rendererSize.y, false);
      this.render();
    }
  }

  capture({ view = 'sheet', size = 1200, name = '' } = {}) {
    if (!this.box) throw new Error('Open a model before taking a capture.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    return this.renderCapture({ clean: view !== 'current', draw: () => {
      if (view === 'sheet') {
        const cellWidth = Math.floor(size / 2) - 20;
        const cellHeight = Math.round(cellWidth * .72);
        canvas.width = size;
        canvas.height = 103 + cellHeight * 2;
        context.fillStyle = '#171c1e';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#c4f6e6';
        context.font = '600 20px system-ui';
        context.fillText('ModelCheck / Review', 18, 31);
        context.fillStyle = '#c9d5d7';
        context.font = '14px system-ui';
        context.textAlign = 'right';
        context.fillText(name, size - 18, 31, size * .52);
        context.textAlign = 'left';
        REVIEW_VIEWS.forEach((key, index) => {
          const x = 14 + (index % 2) * (cellWidth + 12);
          const y = 46 + Math.floor(index / 2) * (cellHeight + 35);
          this.drawView(context, this.reviewCamera(key, cellWidth / cellHeight), x, y, cellWidth, cellHeight);
          context.fillStyle = '#d6e1e3';
          context.fillText(VIEWS[key].label, x + 4, y + cellHeight + 19);
        });
      } else {
        const aspect = view === 'current' ? this.camera.aspect : 1.4;
        canvas.width = size;
        canvas.height = Math.max(1, Math.min(4096, Math.round(size / aspect)));
        const camera = view === 'current' ? this.camera.clone() : this.reviewCamera(view, size / canvas.height);
        if (view === 'current') {
          camera.aspect = size / canvas.height;
          camera.updateProjectionMatrix();
        }
        this.drawView(context, camera, 0, 0, canvas.width, canvas.height);
      }
      return pngBlob(canvas);
    } });
  }

  async prepareComparison(buffer, name) {
    const model = this.model;
    const candidate = this.metadata;
    const candidateBox = this.originalBox;
    const baseline = await this.readModel(buffer, name);
    if (model !== this.model) {
      disposeModel(baseline.root);
      throw new Error('Model selection changed. Start the comparison again.');
    }
    const union = candidateBox.clone().union(baseline.originalBox);
    const { scale, offset } = normalizeBounds(union);
    if (!Number.isFinite(scale) || scale <= 0 || !offset.toArray().every(Number.isFinite)) {
      disposeModel(baseline.root);
      throw new Error('The two models are too far apart to frame together.');
    }
    const bounds = new THREE.Box3(
      union.min.clone().multiplyScalar(scale).add(offset),
      union.max.clone().multiplyScalar(scale).add(offset),
    );
    const group = new THREE.Group();
    group.add(baseline.root);
    group.scale.setScalar(scale);
    group.position.copy(offset);
    const report = {
      baseline: baseline.metadata, candidate,
      delta: comparisonDelta(baseline.metadata, candidate),
      framing: 'shared-glb-coordinates',
    };
    let disposed = false;
    return {
      report,
      capture: (options) => {
        if (disposed || model !== this.model) throw new Error('Model selection changed. Start the comparison again.');
        return this.captureComparison(group, bounds, scale, offset, report, options);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        disposeModel(group);
      },
    };
  }

  captureComparison(group, bounds, scale, offset, report, { view, size }) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const views = view === 'sheet' ? REVIEW_VIEWS : [view];
    const margin = 14;
    const gutter = 12;
    const width = Math.floor((size - margin * 2 - gutter) / 2);
    const height = Math.round(width * .61);
    const rowHeight = height + 34;
    canvas.width = size;
    canvas.height = 72 + views.length * rowHeight;
    context.fillStyle = '#171c1e';
    context.fillRect(0, 0, size, canvas.height);
    context.fillStyle = '#c4f6e6';
    context.font = '600 20px system-ui';
    context.fillText('ModelCheck / Compare', margin, 28);
    context.font = '14px system-ui';
    context.fillStyle = '#d6e1e3';
    context.fillText(`Baseline · ${report.baseline.name}`, margin, 55, width);
    context.fillText(`Current · ${report.candidate.name}`, margin + width + gutter, 55, width);

    // Both GLBs use the union's transform so differences in scale and origin remain visible.
    const model = this.model;
    const oldScale = model.scale.clone();
    const oldPosition = model.position.clone();
    const wasVisible = model.visible;
    return this.renderCapture({ clean: true, draw: () => {
      model.scale.setScalar(scale);
      model.position.copy(offset);
      this.scene.add(group);
      try {
        views.forEach((key, index) => {
          const y = 70 + index * rowHeight;
          const camera = this.reviewCamera(key, width / height, bounds);
          model.visible = false;
          group.visible = true;
          this.drawView(context, camera, margin, y, width, height);
          group.visible = false;
          model.visible = true;
          this.drawView(context, camera, margin + width + gutter, y, width, height);
          context.fillText(VIEWS[key].label, margin, y + height + 20);
        });
        return pngBlob(canvas);
      } finally {
        group.removeFromParent();
        model.scale.copy(oldScale);
        model.position.copy(oldPosition);
        model.visible = wasVisible;
      }
    } });
  }

  drawView(context, camera, x, y, width, height) {
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, camera);
    context.drawImage(this.renderer.domElement, x, y, width, height);
  }
}
