# ModelCheck for coding agents

## Inspect generated models

1. Install dependencies with `npm ci` and provision Chromium with `npx playwright install chromium`. On Linux the browser may also require system libraries (`npx playwright install --with-deps chromium`). An installed Edge can be used with `--browser msedge`.
2. Translate the brief into dimensions, axes, and visual checks. The [Python model guide](PYTHON_MODEL_GUIDE.md) covers a Blender-free workflow with worked examples and ways to diagnose export defects. Pick and combine Python geometry techniques and exporters to suit the asset. Save a self-contained GLB. Reuse the generator's stable **`assetId`** and update its **`revision`** for each export when the writer supports **`asset.extras.modelcheck`**.
3. Run `npm run --silent inspect -- "path/to/model.glb" --out review/model.png`. Parse the JSON object on stdout and open the returned **`png`** path with your image-viewing tool. Read the JSON file at **`report`** for bounds and geometry counts.
4. Inspect the model against the brief. For alignment and symmetry, compare the orthographic **Front (+Z)**, **Right (+X)** and **Top (+Y)** panels. Use the ¾ panel for silhouette and depth. To get a larger single view, rerun with `--view right --size 1600`, for example.
5. When the image shows a discrepancy, change the source generator and export a fresh GLB. Run `npm run --silent inspect -- revised.glb --baseline original.glb --out review/comparison.png` and open the returned PNG. The baseline is on the left and the revised model is on the right. They share a camera and GLB coordinates, so a moved origin or changed scale is visible. Check **`identityStatus`** and verify the pairing from the brief or source history if the IDs differ or are missing. Report what changed and what you verified.

The command uses the rest pose and centered camera framing. Use the JSON bounds for exact GLB coordinates. The sheet helps check visible geometry. Use **Section** in the browser to expose inner surfaces, **Motion** to inspect animation clips, and geometry checks to assess properties such as watertightness and topology.

## Send the user a review link

After inspecting the model, run `npm run --silent share -- revised.glb --baseline original.glb --title "Model review" --note "What to check"`. Omit the baseline for a single model. The **`url`** opens the 3D review directly from the same computer, and the server closes after one idle hour. Verify that it opens before sending it. Keep the review directory while the link is in use.

To point out a specific surface, use **Pin** in the browser, then **Save pins**. Add **`--pins <pins.json>`** to the share command. Pins are matched to the exact bytes of the current GLB and stored in the review manifest.

For a user on another device, use **`--static`** and publish the returned **`directory`** to a host the user can reach, with the user's authorization for the files and audience. The directory contains the chosen GLBs and the viewer. Share the resulting hosted address after verifying it. Static generation returns **`url: null`** until you supply hosting.

## Drive the browser directly

Run `npm run dev` or open the static site. A browser automation client can use **Open GLB** or set the **`#files`** file-input value via its file picker API. Wait for **`#state[data-phase="ready"]`**, or read **`#stage-message`** if the phase is **`error`**. Click **Download review PNG** and wait for the download. Use **`?automation`** to skip the default sample.

For a pose or cutaway, set **Animation clip** or **Section axis**, adjust **Animation time** or **Cut position**, then click **Save current view**. The four-view PNG and comparisons always use the full model in its rest pose.

In the page context, **`window.modelCheck.open(file)`** accepts a browser **`File`** object and returns the model report. **`window.modelCheck.capture({view: 'sheet', size: 1200})`** returns a PNG **`Blob`**. **`window.modelCheck.report()`** returns the report for the ready model or `null`. For normal local agent use, the CLI handles browser setup and saving both artifacts.

For a comparison, call **`window.modelCheck.compare(baselineFile, {view: 'right', size: 1200})`** after opening the revised model. It returns **`image`** as a PNG Blob, **`baseline`** and **`candidate`** model data, **`delta`** (candidate minus baseline), **`framing`** and **`identityStatus`**. The CLI keeps the revised report in **`model`** and adds the comparison fields when `--baseline` is present.
