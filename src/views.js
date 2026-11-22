export const VIEWS = {
  iso: { label: '3/4', direction: [1, .7, 1.22], up: [0, 1, 0] },
  front: { label: 'Front (+Z)', direction: [0, 0, 1], up: [0, 1, 0] },
  right: { label: 'Right (+X)', direction: [1, 0, 0], up: [0, 1, 0] },
  top: { label: 'Top (+Y)', direction: [0, 1, 0], up: [0, 0, -1] },
  back: { label: 'Back (-Z)', direction: [0, 0, -1], up: [0, 1, 0] },
  bottom: { label: 'Bottom (-Y)', direction: [0, -1, 0], up: [0, 0, 1] },
};

export const CAPTURE_VIEWS = ['sheet', ...Object.keys(VIEWS)];
