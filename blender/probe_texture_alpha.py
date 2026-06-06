import argparse
import os
import sys

import bpy


def parse_args():
    raw_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Absolute path to the image to inspect")
    return parser.parse_args(raw_args)


def main():
    args = parse_args()
    image_path = os.path.abspath(args.image)
    if not os.path.exists(image_path):
        raise FileNotFoundError(image_path)

    image = bpy.data.images.load(image_path, check_existing=False)
    try:
        pixels = list(image.pixels)
        alpha_values = pixels[3::4]
        if not alpha_values:
            print(f"IMAGE {image_path} has no alpha values")
            return

        min_alpha = min(alpha_values)
        max_alpha = max(alpha_values)
        transparent = sum(1 for value in alpha_values if value <= 0.001)
        clipped = sum(1 for value in alpha_values if value < 0.3333)
        non_opaque = sum(1 for value in alpha_values if value < 0.999)
        total = len(alpha_values)
        print(
            f"IMAGE {image_path} size={image.size[0]}x{image.size[1]} alpha_min={min_alpha:.4f} alpha_max={max_alpha:.4f} "
            f"transparent={transparent}/{total} clipped={clipped}/{total} non_opaque={non_opaque}/{total}"
        )
    finally:
        bpy.data.images.remove(image)


if __name__ == "__main__":
    main()