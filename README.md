# ModelCheck

**A local GLB viewer for people and coding agents.** Open a generated 3D model, inspect it from several angles, and compare two revisions in the same frame.

![ModelCheck compares a rover with a raised rear wheel against the corrected version](docs/rover-comparison.png)

The rover on the left has a raised rear wheel. Its triangle count and overall bounds match the corrected rover on the right. The side view shows what changed.

## Open a GLB in the browser

Requires **Node.js 22.12+** and a **WebGL 2** browser.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The two example rovers are ready to inspect. Click **Compare versions** and choose **Right** to see the wheel alignment.

- **Open GLB** or drop files into the viewport. Use **Open folder** to browse and filter models in a directory tree.
- **Inspect** with orbit, pan, zoom, camera presets, grid, and wireframe. The Inspector shows mesh and triangle counts, bounds, materials, and animation clips.
- **Capture** the current view or a four-angle PNG. **Compare versions** uses shared GLB coordinates so changes in size and position remain visible. Pick a baseline from the library or your filesystem, then export the comparison PNG or the changes as JSON.

GLB files selected in the browser stay on your device. ModelCheck reads self-contained **GLB 2.0** files with embedded buffers and textures. Animated assets are inspected in their initial pose.

[See the viewer workspace](docs/workspace.png)

## Give a coding agent a visual check

The agent can generate a GLB with Python, run the inspection command, and open the returned **PNG** with its image tool. After editing the generator, it can render **before and after** together to check its changes.

```sh
npx playwright install chromium
npm run --silent inspect -- public/rover.glb --baseline public/rover-raised.glb --view right --out review/rover-comparison.png
```

The command uses the same viewer as the browser. It writes a **PNG** and **JSON** and prints their absolute paths to stdout. Comparison data includes both models and the signed changes in bounds and counts. The CLI includes hashes of the inputs and PNG. It uses a local browser and requires no API key.

Omit **`--baseline`** to inspect one GLB. Use **`--view`** with `sheet` (default), `front`, `right`, `top`, or `iso`. Use **`--size`** for image width (480–2400 px) and **`--report`** for a custom JSON path.

On Linux, use `npx playwright install --with-deps chromium` if browser system libraries are missing. For an existing Edge installation, use **`--browser msedge`**.

## Build a model with Python

The [Python guide](PYTHON_MODEL_GUIDE.md) walks an agent through translating a brief into dimensions, generating a parametric stand, verifying the GLB, and checking a revised model against its baseline. It includes a Blender Python export example. The [agent instructions](AGENTS.md) describe the CLI output and browser API.

## Build and test

```sh
npm run build
npm test
npm run preview
```

The browser smoke tests use the build in **`dist/`**. They exercise opening files, exporting images, and checking that CLI and browser captures match. To test with an existing Edge installation, set **`MODELCHECK_BROWSER=msedge`**.

For GitHub Pages, set **Settings → Pages → Source** to **GitHub Actions** and run **Deploy demo to Pages**. The browser viewer runs as a static site. The CLI runs from a local checkout.

[MIT license](LICENSE)
