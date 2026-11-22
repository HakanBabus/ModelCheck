"""Generate a self-contained GLB 2.0 rover using only the Python standard library."""

import argparse
import json
import math
import struct
from pathlib import Path


PALETTE = [
    ("Seafoam ceramic", [0.31, 0.80, 0.64, 1], 0.16, 0.36),
    ("Dark rubber", [0.035, 0.050, 0.055, 1], 0.05, 0.73),
    ("Warm ivory", [0.84, 0.87, 0.83, 1], 0.24, 0.32),
    ("Amber", [0.98, 0.40, 0.075, 1], 0.15, 0.30),
    ("Lens", [0.06, 0.30, 0.34, 1], 0.65, 0.22),
]


def prism(sides, radius, length):
    """Build an X-axis cylinder with flat caps and shared side normals."""
    positions, normals, indices = [], [], []
    ring = [(math.cos(i * math.tau / sides), math.sin(i * math.tau / sides))
            for i in range(sides)]
    for x in (-length / 2, length / 2):
        for y, z in ring:
            positions.append((x, y * radius, z * radius))
            normals.append((0, y, z))
    for i in range(sides):
        j = (i + 1) % sides
        indices.extend((i, j, sides + j, i, sides + j, sides + i))
    for side in (-1, 1):
        start = len(positions)
        x = side * length / 2
        positions.append((x, 0, 0))
        normals.append((side, 0, 0))
        for y, z in ring:
            positions.append((x, y * radius, z * radius))
            normals.append((side, 0, 0))
        for i in range(sides):
            current, following = start + 1 + i, start + 1 + (i + 1) % sides
            indices.extend((start, current, following) if side == 1
                           else (start, following, current))
    return positions, normals, indices


def box(width, height, depth, bevel):
    """Build a chamfered box from three octagonal rings."""
    w, h, d = width / 2, height / 2, depth / 2
    b = min(bevel, w * .48, h * .48, d * .48)
    rim = [(-w+b, -d), (w-b, -d), (w, -d+b), (w, d-b),
           (w-b, d), (-w+b, d), (-w, d-b), (-w, -d+b)]
    rings = [[(x * (w-inset)/w, y, z * (d-inset)/d) for x, z in rim]
             for y, inset in [(-h, b), (-h+b, 0), (h-b, 0), (h, b)]]
    positions, normals, indices = [], [], []

    def face(points):
        u = [points[1][axis] - points[0][axis] for axis in range(3)]
        v = [points[2][axis] - points[0][axis] for axis in range(3)]
        cross = [u[(i+1) % 3] * v[(i+2) % 3] - u[(i+2) % 3] * v[(i+1) % 3]
                 for i in range(3)]
        length = math.sqrt(sum(n*n for n in cross))
        normal = tuple(n / length for n in cross)
        start = len(positions)
        positions.extend(points)
        normals.extend([normal] * len(points))
        for i in range(1, len(points) - 1):
            indices.extend((start, start+i, start+i+1))

    face(rings[0])
    face(rings[-1][::-1])
    for low, high in zip(rings, rings[1:]):
        for i in range(8):
            j = (i + 1) % 8
            face([low[i], high[i], high[j], low[j]])
    return positions, normals, indices


class Model:
    def __init__(self, asset_id=None, revision=None, palette=PALETTE):
        self.data = bytearray()
        self.doc = {
            "asset": {"version": "2.0", "generator": "ModelCheck Python example"},
            "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
            "bufferViews": [], "accessors": [],
            "materials": [{"name": name, "pbrMetallicRoughness": {
                "baseColorFactor": color, "metallicFactor": metal,
                "roughnessFactor": roughness}} for name, color, metal, roughness in palette],
        }
        if asset_id:
            identity = {"assetId": asset_id}
            if revision:
                identity["revision"] = revision
            self.doc["asset"]["extras"] = {"modelcheck": identity}

    def accessor(self, values, layout, bounds=False):
        offset = len(self.data)
        formats = {"VEC2": ("<2f", 5126), "VEC3": ("<3f", 5126), "VEC4": ("<4f", 5126),
                   "seconds": ("<f", 5126), "indices": ("<H", 5123)}
        packing, component = formats[layout]
        if layout.startswith("VEC"):
            for value in values:
                self.data.extend(struct.pack(packing, *value))
        else:
            self.data.extend(struct.pack(f"<{len(values)}{packing[-1]}", *values))
        view = len(self.doc["bufferViews"])
        self.doc["bufferViews"].append({"buffer": 0, "byteOffset": offset,
                                        "byteLength": len(self.data) - offset})
        self.data.extend(b"\x00" * (-len(self.data) % 4))
        entry = {"bufferView": view, "componentType": component, "count": len(values),
                 "type": layout if layout.startswith("VEC") else "SCALAR"}
        if bounds:
            axes = list(zip(*values)) if layout.startswith("VEC") else [values]
            entry["min"] = [min(axis) for axis in axes]
            entry["max"] = [max(axis) for axis in axes]
        self.doc["accessors"].append(entry)
        return len(self.doc["accessors"]) - 1

    def part(self, name, geometry, center, material, rotation=None, uvs=None):
        positions, normals, indices = geometry
        primitive = {"attributes": {"POSITION": self.accessor(positions, "VEC3", True),
                                      "NORMAL": self.accessor(normals, "VEC3")},
                     "indices": self.accessor(indices, "indices"), "material": material}
        if uvs is not None:
            primitive["attributes"]["TEXCOORD_0"] = self.accessor(uvs, "VEC2")
        mesh = len(self.doc["meshes"])
        self.doc["meshes"].append({"name": name, "primitives": [primitive]})
        node = {"name": name, "mesh": mesh, "translation": center}
        if rotation:
            node["rotation"] = rotation
        self.doc["scenes"][0]["nodes"].append(len(self.doc["nodes"]))
        self.doc["nodes"].append(node)

    def texture(self, data):
        offset = len(self.data)
        self.data.extend(data)
        views = self.doc["bufferViews"]
        view = len(views)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        self.data.extend(b"\x00" * (-len(self.data) % 4))
        images = self.doc.setdefault("images", [])
        images.append({"bufferView": view, "mimeType": "image/png"})
        textures = self.doc.setdefault("textures", [])
        textures.append({"source": len(images) - 1})
        return {"index": len(textures) - 1}

    def write(self, path):
        self.doc["buffers"] = [{"byteLength": len(self.data)}]
        document = json.dumps(self.doc, separators=(",", ":")).encode()
        document += b" " * (-len(document) % 4)
        size = 12 + 8 + len(document) + 8 + len(self.data)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(struct.pack("<4sII", b"glTF", 2, size)
                         + struct.pack("<I4s", len(document), b"JSON") + document
                         + struct.pack("<I4s", len(self.data), b"BIN\x00") + self.data)


def animate_sensor(model):
    nodes = model.doc["nodes"]
    roots = model.doc["scenes"][0]["nodes"]
    pivot = (.07, 1.52, -.19)
    children = [index for index in roots if nodes[index]["name"].startswith("Sensor ")]
    for index in children:
        node = nodes[index]
        node["translation"] = [value - origin for value, origin in zip(node["translation"], pivot)]
        roots.remove(index)
    target = len(nodes)
    nodes.append({"name": "Sensor pivot", "translation": pivot, "children": children})
    roots.append(target)

    times = model.accessor([0, .7, 1.45, 2.2], "seconds", bounds=True)
    model.doc["animations"] = []
    for name, axis, amplitude in (("Sensor sweep", 1, .78), ("Sensor tilt", 0, .32)):
        rotations = []
        for angle in (0, amplitude, -amplitude, 0):
            rotation = [0, 0, 0, math.cos(angle / 2)]
            rotation[axis] = math.sin(angle / 2)
            rotations.append(rotation)
        model.doc["animations"].append({
            "name": name,
            "samplers": [{"input": times, "output": model.accessor(rotations, "VEC4"), "interpolation": "LINEAR"}],
            "channels": [{"sampler": 0, "target": {"node": target, "path": "rotation"}}],
        })


def make_rover(raised_wheel, animate=False):
    model = Model("modelcheck:rover", "v1" if raised_wheel else "v2")

    def block(name, size, center, color, bevel=.055):
        model.part(name, box(*size, bevel), center, color)

    block("Lower chassis", (1.76, .38, 2.19), (0, .60, 0), 1)
    block("Mint body", (1.96, .51, 2.20), (0, .96, 0), 0, .12)
    block("Ivory deck", (1.76, .11, 1.96), (0, 1.25, -.05), 2)
    block("Front bumper", (1.65, .15, .18), (0, .68, 1.18), 2)
    block("Rear bumper", (1.65, .15, .18), (0, .68, -1.18), 2)
    block("Cab base", (.73, .28, .63), (.07, 1.43, -.22), 1)
    block("Sensor housing", (1.13, .52, .64), (.07, 1.76, -.19), 0, .10)
    block("Sensor face", (.97, .32, .085), (.07, 1.77, .153), 1)
    block("Sensor lens A", (.36, .22, .06), (-.17, 1.77, .204), 4)
    block("Sensor lens B", (.36, .22, .06), (.32, 1.77, .204), 4)
    block("Antenna", (.065, .43, .065), (.40, 2.15, -.34), 2)
    block("Antenna cap", (.13, .10, .13), (.40, 2.40, -.34), 3)
    for index in range(4):
        block(f"Deck vent {index + 1}", (.88, .045, .064), (0, 1.328, .36 + index*.13), 4, .012)
    for side in (-1, 1):
        x = side * 1.04
        block("Side rail", (.15, .14, 1.75), (x, 1.03, 0), 2)
        block("Marker light", (.32, .16, .08), (side * .66, .96, 1.13), 3)
        for z in (-.76, .76):
            y = .59 if raised_wheel and side == 1 and z < 0 else .43
            model.part("Tire", prism(24, .43, .34), (side * 1.17, y, z), 1)
            model.part("Rim", prism(24, .27, .05), (side * 1.35, y, z), 2)
            model.part("Hub", prism(16, .125, .067), (side * 1.39, y, z), 3)
            for i in range(14):
                angle = i * math.tau / 14
                model.part("Tread", box(.29, .06, .13, .015),
                           (side * 1.17, y + .415 * math.cos(angle),
                            z + .415 * math.sin(angle)), 1,
                           (math.sin(angle / 2), 0, 0, math.cos(angle / 2)))
    if animate:
        model.doc["asset"]["extras"]["modelcheck"]["revision"] += "-motion"
        animate_sensor(model)
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--raised-wheel", action="store_true", help="Lift the rear-right wheel.")
    parser.add_argument("--animate", action="store_true", help="Include sensor sweep and tilt clips.")
    args = parser.parse_args()
    output = args.out or Path("public/rover-motion.glb" if args.animate else "public/rover.glb")
    make_rover(args.raised_wheel, args.animate).write(output)
    print(output)
