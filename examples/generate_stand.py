"""Generate a small parametric display stand as a self-contained GLB."""

import argparse
import math
from pathlib import Path

from generate_rover import Model, box


def make_stand(width, height, depth, revision=None):
    """Keep the bottom at Y=0 and center the stand around X=Z=0."""
    thickness = min(width, height, depth) * 0.12
    bevel = thickness * 0.15
    post_height = height - 2 * thickness
    model = Model("modelcheck:stand", revision)

    def part(name, dimensions, center, material):
        model.part(name, box(*dimensions, bevel), center, material)

    part("Base", (width, thickness, depth), (0, thickness / 2, 0), 1)
    part("Platform", (width, thickness, depth), (0, height - thickness / 2, 0), 0)
    for side, name in [(-1, "Left post"), (1, "Right post")]:
        x = side * (width / 2 - thickness)
        part(name, (thickness, post_height, thickness), (x, height / 2, 0), 2)
    return model


def positive_dimension(text):
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("dimensions must be finite and greater than zero")
    return value


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--width", type=positive_dimension, default=1.6, help="X dimension")
    parser.add_argument("--height", type=positive_dimension, default=1.2, help="Y dimension")
    parser.add_argument("--depth", type=positive_dimension, default=0.8, help="Z dimension")
    parser.add_argument("--revision", help="Revision label to write into the GLB")
    parser.add_argument("--out", type=Path, default=Path("review/stand.glb"))
    args = parser.parse_args()
    make_stand(args.width, args.height, args.depth, args.revision).write(args.out)
    print(args.out)
