# Python model generation for coding agents

Keep an editable Python generator, export a GLB, and open a rendered image of the output before reporting that a visual requirement is met.

## Turn the brief into parameters

Write down what you can check before making geometry. For a display stand, that might be **1.6 m wide, 1.2 m high and 0.8 m deep**, centered on **X** and **Z**, with its base on **Y = 0**. Identify which parts need to move when a dimension changes. Map those decisions to named parameters in the generator.

Use pure Python for basic procedural geometry. Use **Blender Python** when you need modifiers, detailed materials, UVs, or animation. Keep equivalent assets in the same units and coordinate system across revisions so ModelCheck shows real changes in placement and size.

## Build a parametric stand

After following the setup in the [README](README.md), run this from the repository root:

```sh
python examples/generate_stand.py --width 1.6 --height 1.2 --depth 0.8 --revision v1 --out review/stand-v1.glb
npm run --silent inspect -- review/stand-v1.glb --out review/stand-v1.png
```

[The generator](examples/generate_stand.py) uses **`make_stand(width, height, depth)`** to define four parts. The base is centered at half its thickness on Y, so the bottom is at zero. The platform's upper face is at **`height`**. Both posts are derived from those dimensions and remain symmetric when the stand changes width.

1. Open the **`png`** path from stdout with the agent's image tool. Check that the base and platform span the posts, that the posts are mirrored, and that there are no visible gaps.
2. Open the **`report`** path. Check **`model.bounds.size`** against **`[1.6, 1.2, 0.8]`** in XYZ order, allowing a small floating-point tolerance. Check that **`model.bounds.min[1]`** is near zero.
3. When the brief changes, regenerate into a distinct file. Suppose the stand now needs to be **2.0 m wide**. Export the revised model and compare it with the previous one.

```sh
python examples/generate_stand.py --width 2.0 --height 1.2 --depth 0.8 --revision v2 --out review/stand-v2.glb
npm run --silent inspect -- review/stand-v2.glb --baseline review/stand-v1.glb --view front --out review/stand-comparison.png
```

Check that the revised stand is wider and remains centered in the PNG. Expect **`delta.bounds.size[0]`** to be near **+0.4**, with no change to height, depth, or triangle count. Keep the generator, the final GLB, and a review image for the handoff.

## Record which model the versions belong to

Choose a stable **`assetId`** once per logical asset and keep it in the generator. Change **`revision`** with each meaningful export. If you're editing a generator that already has an ID, carry it forward. For the stand example, both files use **`modelcheck:stand`**, and the commands above label the outputs **`v1`** and **`v2`**.

The sample writer can attach these fields directly. Use your own project prefix and asset name.

```python
model = Model(asset_id="my-project:display-stand", revision="v2")
```

In the GLB JSON chunk, the fields live under **`asset.extras.modelcheck`**. The comparison still takes an explicit **baseline**. Read **`identityStatus`** from its JSON and check **`baseline.identity`** and **`model.identity`**:

| Status | What to do |
| --- | --- |
| **`matching-id`** | Confirm the revision labels and inspect the intended change. |
| **`different-ids`** | Confirm that comparing these two assets is intentional. |
| **`unrecorded`** | Confirm the baseline and current file from the brief or generator history. |

These are labels written by the exporter. Keep the baseline GLB and source revision if you need to reproduce a review later.

## Run the dependency-free example

Run these commands from the ModelCheck root, after installing the Node dependencies and browser listed in the [README](README.md). The generator uses the Python standard library.

```sh
python examples/generate_rover.py --raised-wheel --out review/rover-before.glb
python examples/generate_rover.py --out review/rover-after.glb
npm run --silent inspect -- review/rover-after.glb --baseline review/rover-before.glb --view right --out review/rover-comparison.png
```

In the **Right (+X)** comparison, the rear-right tire on the baseline is higher because **`make_rover()`** sets its center to **`y = .59`**. The revised version puts all four centers at **`y = .43`**. The two versions have identical overall bounds and mesh counts. Use the image to verify the wheel alignment.

### Change the example

- **`block()`** builds a solid chamfered box. Edit the body dimensions or add a part with a name, dimensions, position, and material index.
- **`prism()`** builds a capped cylinder along the X axis. The rover uses it for tires, rims, and hubs.
- **`PALETTE`** sets linear RGBA base colors, metallic factors, and roughness.
- **`Model.write()`** packs indexed triangle geometry, normals, transforms, and materials into a single GLB. Mesh coordinates follow glTF's Y-up convention. This rover treats +Z as its front.

## Export from Blender Python

If your model uses Blender modifiers, UVs or textures, write the scene with **`bpy`** and export it from Blender's Python runtime. Example `make_model.py`:

```python
from pathlib import Path
import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
output = Path(args[0] if args else "model.glb").resolve()
output.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
base = bpy.context.object
base.name = "Base"
base.dimensions = (1.6, 0.8, 1.0)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.36, location=(0.25, 0, 1.15))
bpy.context.object.name = "Cap"

bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_yup=True)
```

```sh
blender --background --factory-startup --python-exit-code 1 --python make_model.py -- review/blender.glb
npm run inspect -- review/blender.glb --out review/blender.png
```

Blender uses Z-up in its scene. Its glTF exporter converts to Y-up with **`export_yup=True`**. Check the exported front in ModelCheck and use the JSON bounds if your project requires exact dimensions. See the [Blender glTF export API](https://docs.blender.org/api/main/bpy.ops.export_scene.html).
