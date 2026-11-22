# Generate and inspect a GLB with Python

## Run the dependency-free example

Run these commands from the ModelCheck root, after installing the Node dependencies and browser listed in the [README](README.md). The generator uses the Python standard library.

```sh
python examples/generate_rover.py --raised-wheel --out review/before/rover.glb
npm run inspect -- review/before/rover.glb --out review/before/rover.png

python examples/generate_rover.py --out review/after/rover.glb
npm run inspect -- review/after/rover.glb --out review/after/rover.png
```

In the first PNG, look at the **Right (+X)** panel. The rear-right tire is higher because **`make_rover()`** sets its center to **`y = .59`**, while the other wheel centers are **`y = .43`**. The second command pair puts all four centers at the same height. The two versions use identical overall bounds and mesh counts. The difference appears in the rendered silhouette and wheel alignment.

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
