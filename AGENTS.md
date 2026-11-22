# Create and review an asset with ModelCheck

When a user asks you to make or revise a 3D asset with ModelCheck, carry the job through **Python source → GLB → visual critique → revised GLB → delivery**. Run the workflow yourself when you have the tools. The viewer also works on an existing GLB when the user asks for inspection only.

## Start from the request

- Reuse a local checkout or clone **`https://github.com/HakanBabus/ModelCheck.git`** to a work directory. Read [the Python guide](PYTHON_MODEL_GUIDE.md). Run **`npm ci`** in the ModelCheck checkout. The CLI tries Playwright Chromium and installed Chrome or Edge. If it reports that no browser is available, use **`npx playwright install chromium`** or configure an installed channel with **`--browser`**.
- Identify the intended role, reference style and viewing distance. Look for the target project's units, axes, pivot, naming and asset folder. Treat unspecified details as design choices and proceed with sensible assumptions. Use only reference material the user has supplied or authorized for the job.
- Generate a self-contained GLB with a Python technique that serves the asset. For a detailed prop, consider the silhouette, construction, material separation and close-up surfaces at the intended viewing distance. Preserve editable source and any dependencies. [Worked asset example](docs/DETAILED_ASSET_EXAMPLE.md)

## Open the render and critique it

Run from the ModelCheck checkout. Give absolute paths for outputs in another project.

```sh
npm run --silent inspect -- "/path/to/draft.glb" --out "/path/to/review/draft.png"
```

Open the returned **`png`** with your image tool and read **`report`**. A successful export and matching bounds are only the beginning of the review. Judge the image critically against the brief and references.

- Look for the most consequential problems first. Check silhouette and proportions, joins and clearances, bevels and shading, material separation, and whether small details hold up at the intended camera distance. Look for floating parts, overlaps, distorted textures, odd highlights and accidental asymmetry.
- Name the issue, the view that exposes it, and the source change that would address it. For example, “Front shows the grip drifting to the right of the blade. Center the grip group, keep the pivot, and re-export.” Use a larger render such as **`--view iso --size 1600`** or inspect **`--view back`** and **`--view bottom`**.
- Edit the generator, export to a distinct path, and inspect again. When the visual difference matters, pass **`--baseline "/path/to/draft.glb"`** and open the resulting comparison. Keep the same **`assetId`** for that asset and advance **`revision`** if the exporter supports **`asset.extras.modelcheck`**. The caller selects the baseline. Confirm the relationship from source history if the report cannot establish matching IDs.
- Stop when the asset meets the visible and measurable requirements, or report the specific remaining issue. Ground praise and criticism in what you actually saw. Check motion, hidden geometry, collision or texture fidelity separately when they matter. If image viewing is unavailable, report the checks you performed and leave visual acceptance open.

## Deliver the asset

Put the final GLB in the requested project location when available. Keep drafts, screenshots and reports outside the runtime asset directory unless the project uses them there. Provide the generator and any files it needs to reproduce the asset. If the request names a target application, verify the final import when its tooling is available and report what ran.

Give the user the **GLB**, an **inspection image** and a short summary of what changed and what was checked. For interactive review, **`npm run --silent share -- final.glb`** returns a local URL. Use **`--baseline`** or **`--pins`** for a comparison or point notes when useful. A review for another device needs an authorized host and **`--static`**. [Sharing and viewer tools](README.md#share-an-interactive-review)
