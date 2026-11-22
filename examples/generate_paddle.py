"""Generate the Rally table-tennis prop with embedded procedural textures."""

import argparse
import math
import struct
import zlib
from pathlib import Path

from generate_rover import Model


PALETTE = [
    ("Maple veneer", (.79, .54, .27, 1), 0, .52),
    ("Walnut ply", (.25, .12, .054, 1), 0, .61),
    ("Fiber ply", (.055, .095, .11, 1), .16, .54),
    ("Ink blue rubber", (1, 1, 1, 1), 0, .77),
    ("Oxblood rubber", (1, 1, 1, 1), 0, .77),
    ("Amber sponge", (.88, .36, .11, 1), 0, .91),
    ("Oiled walnut grip", (1, 1, 1, 1), 0, .47),
    ("Brass inlay", (.78, .52, .19, 1), .68, .38),
    ("Blue butt cap", (.035, .16, .20, 1), .13, .43),
]
MAPLE, WALNUT, FIBER, BLUE, RED, SPONGE, GRIP, BRASS, CAP = range(len(PALETTE))


def polygon_slab(outline, back, front, bevel):
    """Build a closed slab with planar UVs and bevel normals."""
    center_x = sum(point[0] for point in outline) / len(outline)
    center_y = sum(point[1] for point in outline) / len(outline)
    min_x, min_y = map(min, zip(*outline))
    max_x, max_y = map(max, zip(*outline))
    inset = min(.12, max(.005, bevel / (max_x - min_x) * 2.5))
    rings = [
        [(center_x + (x - center_x) * scale, center_y + (y - center_y) * scale, z)
         for x, y in outline]
        for z, scale in [(back, 1 - inset), (back + bevel, 1),
                         (front - bevel, 1), (front, 1 - inset)]
    ]
    positions, normals, indices, uvs = [], [], [], []

    def face(points, surface_normal=None):
        if surface_normal is None:
            u = [b - a for a, b in zip(points[0], points[1])]
            v = [b - a for a, b in zip(points[0], points[2])]
            normal = [u[(i + 1) % 3] * v[(i + 2) % 3] - u[(i + 2) % 3] * v[(i + 1) % 3] for i in range(3)]
            length = math.sqrt(sum(component * component for component in normal))
            surface_normal = tuple(component / length for component in normal)
        start = len(positions)
        positions.extend(points)
        normals.extend([surface_normal] * len(points))
        mirrored = surface_normal[2] < -.95
        for x, y, _ in points:
            u = (x - min_x) / (max_x - min_x)
            uvs.append((1 - u if mirrored else u, (max_y - y) / (max_y - min_y)))
        for index in range(1, len(points) - 1):
            indices.extend((start, start + index, start + index + 1))

    for ring, normal in [(rings[0][::-1], (0, 0, -1)), (rings[-1], (0, 0, 1))]:
        center = (center_x, center_y, ring[0][2])
        for i, point in enumerate(ring):
            face([center, point, ring[(i + 1) % len(ring)]], normal)
    for low, high in zip(rings, rings[1:]):
        for i in range(len(outline)):
            j = (i + 1) % len(outline)
            face([low[i], low[j], high[j], high[i]])
    return (positions, normals, indices), uvs


def blade_outline(width, height, bottom):
    return [
        (width * math.cos(angle) * (1 - .28 * max(0, -math.sin(angle)) ** 3),
         bottom + height * (.5 + .5 * math.sin(angle)))
        for angle in (math.tau * index / 80 for index in range(80))
    ]


def trim_throat(outline, height):
    trimmed = []
    for start, end in zip(outline[-1:] + outline[:-1], outline):
        if (start[1] < height) != (end[1] < height):
            fraction = (height - start[1]) / (end[1] - start[1])
            trimmed.append((start[0] + fraction * (end[0] - start[0]), height))
        if end[1] >= height:
            trimmed.append(end)
    return trimmed


def png(size, color_at):
    """Encode an RGB texture using only the standard library."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            pixels.extend(max(0, min(255, round(value))) for value in color_at(x / size, y / size))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixels, 8))
            + chunk(b"IEND", b""))


def rubber_pattern(u, v):
    x = (u * 91 + (int(v * 91) % 2) * .5) % 1 - .5
    y = (v * 91) % 1 - .5
    return max(0, 1 - 11 * (x * x + y * y)) ** 2


def rubber_color(base, mark, u, v):
    # Keep the graphic near the throat so the striking surface can read as rubber.
    y = v - .79
    start = .18 + y * 1.65
    stripe = 0 <= y < .10 and any(start + i * .048 <= u < start + i * .048 + .024 for i in range(3))
    ring = math.hypot(u - .64, v - .824)
    color = mark if stripe or .022 < ring < .029 else base
    grain = (math.sin(483 * u + 306 * v) + math.sin(1246 * u - 927 * v)) * 1.35
    return tuple(channel + grain + rubber_pattern(u, v) * 13 for channel in color)


def wood_grain(u, v):
    warp = .024 * math.sin(8.2 * v + 3.1 * u) + .006 * math.sin(24.9 * v - 8 * u)
    streak = u + warp
    growth_rings = math.sin(145 * streak + 1.6 * math.sin(18 * streak))
    pores = math.sin(586 * streak + math.sin(83 * v + 13 * u)) * .4
    color_drift = math.sin(23 * u + 1.8 * v) * .45
    return growth_rings + pores + color_drift


def wood_color(base, u, v):
    grain = wood_grain(u, v)
    return tuple(channel + grain * shade for channel, shade in zip(base, (11, 8, 5)))


def height_normal(u, v):
    step = 1 / 512
    dx = rubber_pattern(u + step, v) - rubber_pattern(u - step, v)
    dy = rubber_pattern(u, v + step) - rubber_pattern(u, v - step)
    return (128 - 24 * dx, 128 + 24 * dy, 252)


def make_paddle(revision, draft):
    model = Model("modelcheck:rally-paddle", revision, PALETTE)
    materials = model.doc["materials"]
    blue = png(512, lambda u, v: rubber_color((23, 74, 88), (234, 191, 111), u, v))
    red = png(512, lambda u, v: rubber_color((107, 23, 41), (221, 147, 100), u, v))
    maple = png(256, lambda u, v: wood_color((193, 134, 71), u, v))
    walnut = png(256, lambda u, v: wood_color((105, 65, 42), u, v))
    normal = model.texture(png(512, height_normal))
    for index, data in [(BLUE, blue), (RED, red), (MAPLE, maple), (GRIP, walnut)]:
        pbr = materials[index]["pbrMetallicRoughness"]
        pbr["baseColorFactor"] = [1, 1, 1, 1]
        pbr["baseColorTexture"] = model.texture(data)
    for index in [BLUE, RED]:
        materials[index]["normalTexture"] = {**normal, "scale": .33}
    wood_roughness = model.texture(png(256, lambda u, v: (255, 135 + 15 * wood_grain(u, v), 0)))
    for index in [MAPLE, GRIP]:
        pbr = materials[index]["pbrMetallicRoughness"]
        pbr["roughnessFactor"] = 1
        pbr["metallicRoughnessTexture"] = wood_roughness

    def slab(name, outline, limits, bevel, material, offset=0):
        geometry, uv = polygon_slab(outline, *limits, bevel)
        model.part(name, geometry, (offset, 0, 0), material, uvs=uv)

    blade = blade_outline(.076, .169, .023)
    for name, limits, material in [
        ("Core ply", (-.00115, .00115), MAPLE),
        ("Front fiber ply", (.00115, .0016), FIBER),
        ("Back fiber ply", (-.0016, -.00115), FIBER),
        ("Front walnut ply", (.0016, .00245), WALNUT),
        ("Back walnut ply", (-.00245, -.0016), WALNUT),
        ("Front maple veneer", (.00245, .00315), MAPLE),
        ("Back maple veneer", (-.00315, -.00245), MAPLE),
    ]:
        slab(name, blade, limits, .00009, material)

    rubber = blade_outline(.0758, .1475, .0443) if draft else trim_throat(blade_outline(.075, .167, .024), .053)
    slab("Front amber sponge", rubber, (.00315, .00465), .00012, SPONGE)
    slab("Back amber sponge", rubber, (-.00465, -.00315), .00012, SPONGE)
    slab("Ink blue playing face", rubber, (.00465, .0059), .00017, BLUE)
    slab("Oxblood playing face", rubber, (-.0059, -.00465), .00017, RED)

    tang = [(-.019, -.069), (.019, -.069), (.017, -.044), (.014, .010),
            (.0125, .037), (-.0125, .037), (-.014, .010), (-.017, -.044)]
    grip = [(-.016, -.065), (.016, -.065), (.0186, -.059), (.017, -.040),
            (.0134, -.008), (.0125, .011), (.015, .020), (.014, .025),
            (-.014, .025), (-.015, .020), (-.0125, .011), (-.0134, -.008),
            (-.017, -.040), (-.0186, -.059)]
    boot = [(-.018, -.071), (.018, -.071), (.0194, -.069),
            (.0187, -.062), (-.0187, -.062), (-.0194, -.069)]
    stripe = [(-.0013, -.050), (.0013, -.050), (.0013, -.009), (-.0013, -.009)]
    grip_offset = .008 if draft else 0
    slab("Maple handle tang", tang, (-.0031, .0031), .0010, MAPLE, grip_offset)
    slab("Front walnut handle scale", grip, (.0031, .0135), .0028, GRIP, grip_offset)
    slab("Back walnut handle scale", grip, (-.0135, -.0031), .0028, GRIP, grip_offset)
    slab("Handle butt cap", boot, (-.012, .012), .0015, CAP, grip_offset)
    slab("Front brass inlay", stripe, (.0134, .0140), .00019, BRASS, grip_offset)
    slab("Back brass inlay", stripe, (-.0140, -.0134), .00019, BRASS, grip_offset)
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--draft", action="store_true", help="Generate the misaligned grip and rounded rubber edge.")
    parser.add_argument("--revision", help="Defaults to v1 for the draft and v2 for the corrected asset.")
    args = parser.parse_args()
    revision = args.revision or ("v1" if args.draft else "v2")
    make_paddle(revision, args.draft).write(args.out)
    print(args.out)
