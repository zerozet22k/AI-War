"""Reconstruct a clean base mesh from one isolated concept image.

This is an offline art-pipeline tool. It is intentionally not imported by the game.
The generated mesh is a starting point for Blender retopology, rigging, and animation.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from PIL import Image

from hy3dgen.shapegen import (
    DegenerateFaceRemover,
    FaceReducer,
    FloaterRemover,
    Hunyuan3DDiTFlowMatchingPipeline,
)


MODEL_ID = "tencent/Hunyuan3D-2mini"
MODEL_SUBFOLDER = "hunyuan3d-dit-v2-mini"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--resolution", type=int, default=256)
    parser.add_argument("--faces", type=int, default=70000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("A CUDA GPU is required for this reconstruction profile.")

    image = Image.open(args.image).convert("RGBA")
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        MODEL_ID,
        subfolder=MODEL_SUBFOLDER,
        device="cuda",
        dtype=torch.float16,
    )
    generator = torch.Generator(device="cuda").manual_seed(args.seed)
    mesh = pipe(
        image=image,
        num_inference_steps=args.steps,
        guidance_scale=5.0,
        octree_resolution=args.resolution,
        generator=generator,
    )[0]

    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=args.faces)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(args.output)
    print(
        {
            "output": str(args.output),
            "vertices": len(mesh.vertices),
            "faces": len(mesh.faces),
            "seed": args.seed,
            "steps": args.steps,
            "resolution": args.resolution,
        }
    )


if __name__ == "__main__":
    main()
