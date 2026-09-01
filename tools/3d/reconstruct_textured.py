"""Reconstruct AND texture a mesh from one isolated concept image.

Same shape stage as reconstruct_hunyuan.py, plus Hunyuan3D-2's paint
pipeline to bake a real texture from the reference image onto the mesh
(instead of the flat placeholder material the rig scripts apply today).
The shape pipeline is freed from VRAM before the (heavier) paint pipeline
loads, since both together may not fit in 8GB.
"""

from __future__ import annotations

import argparse
import gc
from pathlib import Path

import torch
from PIL import Image

from hy3dgen.shapegen import (
    DegenerateFaceRemover,
    FaceReducer,
    FloaterRemover,
    Hunyuan3DDiTFlowMatchingPipeline,
)
from hy3dgen.texgen import Hunyuan3DPaintPipeline

SHAPE_MODEL_ID = "tencent/Hunyuan3D-2mini"
SHAPE_MODEL_SUBFOLDER = "hunyuan3d-dit-v2-mini"
PAINT_MODEL_ID = "tencent/Hunyuan3D-2"


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

    shape_pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        SHAPE_MODEL_ID, subfolder=SHAPE_MODEL_SUBFOLDER, device="cuda", dtype=torch.float16,
    )
    generator = torch.Generator(device="cuda").manual_seed(args.seed)
    mesh = shape_pipe(
        image=image,
        num_inference_steps=args.steps,
        guidance_scale=5.0,
        octree_resolution=args.resolution,
        generator=generator,
    )[0]
    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=args.faces)

    # Free the shape pipeline's VRAM before loading the paint pipeline.
    del shape_pipe
    gc.collect()
    torch.cuda.empty_cache()

    paint_pipe = Hunyuan3DPaintPipeline.from_pretrained(PAINT_MODEL_ID)
    textured_mesh = paint_pipe(mesh, image=image)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    textured_mesh.export(args.output)
    print({"output": str(args.output), "vertices": len(textured_mesh.vertices), "faces": len(textured_mesh.faces)})


if __name__ == "__main__":
    main()
