# ModelCheck for coding agents

## Inspect generated models

1. Install dependencies with `npm ci` and provision Chromium with `npx playwright install chromium`. On Linux the browser may also require system libraries (`npx playwright install --with-deps chromium`). An installed Edge can be used with `--browser msedge`.
2. Run the model generator and save a self-contained GLB under the project directory.
3. Run `npm run --silent inspect -- "path/to/model.glb" --out review/model.png`. Parse the JSON object on stdout and open the returned **`png`** path with your image-viewing tool. Read the JSON file at **`report`** for bounds and geometry counts.
4. Inspect the model against the brief. For alignment and symmetry, compare the orthographic **Front (+Z)**, **Right (+X)** and **Top (+Y)** panels. Use the ¾ panel for silhouette and depth. To get a larger single view, rerun with `--view right --size 1600`, for example.
5. When the image shows a discrepancy, change the source generator, export a fresh GLB, and capture a new review. Use distinct output names for before/after comparisons. Check the new PNG before reporting the result. JSON describes geometry and captures. Visual inspection requires image access.

The command uses the initial pose and centered camera framing. Use the JSON bounds for exact GLB coordinates. The sheet helps check visible geometry. Watertightness, topology quality, hidden faces and animation motion require separate checks appropriate to the asset.

## Drive the browser directly

Run `npm run dev` or open the static site. A browser automation client can use **Open GLB** or set the **`#files`** file-input value via its file picker API. Wait for **`#state[data-phase="ready"]`**, or read **`#stage-message`** if the phase is **`error`**. Click **Download review PNG** and wait for the download. Use **`?automation`** to skip the default sample.

In the page context, **`window.modelCheck.open(file)`** accepts a browser **`File`** object and returns the model report. **`window.modelCheck.capture({view: 'sheet', size: 1200})`** returns a PNG **`Blob`**. **`window.modelCheck.report()`** returns the report for the ready model or `null`. For normal local agent use, the CLI handles browser setup and saving both artifacts.
