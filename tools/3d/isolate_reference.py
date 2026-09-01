"""Background-removal preprocessing step: turns an opaque game portrait into
an isolated-subject RGBA image suitable as Hunyuan3D-2mini reconstruction
input (matches the alpha-channel isolated reference the Shaper pipeline used).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image
from rembg import remove


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    image = Image.open(args.image).convert("RGBA")
    isolated = remove(image)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    isolated.save(args.output)
    print({"input": str(args.image), "output": str(args.output), "size": isolated.size})


if __name__ == "__main__":
    main()
