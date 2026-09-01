"""Batch pipeline driver: drop full-body reference images into
art/3d/references/incoming/<race>-<unitId>.png (or ...-reference-v1.png) and
run this once. For each new image it will:

  1. isolate the subject (skip if the image already has a clean alpha channel)
  2. reconstruct a base mesh with Hunyuan3D-2mini (GPU)
  3. rig + animate it (currently: biped archetype only — see BIPED_ARCHETYPES)
  4. render a quick preview

Idempotent: re-running skips any unit whose manifest already exists. Meant to
be run standalone by the user/GPU owner, no Claude involvement per step:

  .tools\\hunyuan3d-venv\\Scripts\\python.exe tools\\3d\\run_pipeline.py

Add --fast for lower-quality/faster reconstruction settings, --limit N to
only process the first N pending units (useful for a smoke test).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image
from rembg import remove

ROOT = Path(__file__).resolve().parents[2]
INCOMING = ROOT / "art/3d/references/incoming"
REFERENCES = ROOT / "art/3d/references"
SOURCE = ROOT / "art/3d/source"
EXPORTS = ROOT / "art/3d/exports"
MANIFESTS = ROOT / "art/3d/manifests"
PREVIEWS = ROOT / "art/3d/previews"

BLENDER = ROOT / ".tools/blender/app/blender-5.2.1-windows-x64/blender.exe"
RACE_IDS = ["ironclad", "aether", "nullforge"]

# Archetypes with a working rig script. Everything else gets reconstructed
# (mesh only) and reported as pending a rig archetype that doesn't exist yet.
BIPED_ARCHETYPES = {"builder", "soldier", "scout", "marksman", "support", "rocketeer"}
HEIGHT_BY_ARCHETYPE = {
    "builder": 1.75, "support": 1.75,
    "soldier": 1.9, "scout": 1.85, "marksman": 1.9, "rocketeer": 1.95,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fast", action="store_true", help="fewer reconstruction steps / lower resolution")
    parser.add_argument("--limit", type=int, default=0, help="only process the first N pending units (0 = all)")
    parser.add_argument("--skip-preview", action="store_true")
    return parser.parse_args()


def resolve_race_unit(filename: str) -> tuple[str, str] | None:
    stem = filename.rsplit(".", 1)[0]
    for race in RACE_IDS:
        prefix = f"{race}-"
        if stem.startswith(prefix):
            unit = stem[len(prefix):]
            for suffix in ("-reference-v1", "-reference", "-v1"):
                if unit.endswith(suffix):
                    unit = unit[: -len(suffix)]
            return race, unit
    return None


def load_unit_def(race: str, unit: str) -> dict | None:
    race_json = ROOT / f"src/assets/races/{race}/{race}.race.json"
    data = json.loads(race_json.read_text(encoding="utf-8"))
    return data.get("units", {}).get(unit)


def isolate_if_needed(src: Path, dest: Path) -> None:
    image = Image.open(src)
    if image.mode == "RGBA" and image.getchannel("A").getextrema() != (255, 255):
        # Already has real transparency — treat as pre-isolated, just copy.
        dest.write_bytes(src.read_bytes())
        return
    isolated = remove(image.convert("RGBA"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    isolated.save(dest)


def reconstruct(reference: Path, out_glb: Path, *, fast: bool) -> dict:
    steps = "18" if fast else "30"
    resolution = "192" if fast else "256"
    cmd = [
        sys.executable, str(ROOT / "tools/3d/reconstruct_hunyuan.py"),
        str(reference), str(out_glb),
        "--steps", steps, "--resolution", resolution, "--faces", "70000",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"reconstruction failed:\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}")
    return {"stdout_tail": result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""}


def rig_biped(recon_glb: Path, asset_id: str, race: str, unit: str, role_class: str, height: float) -> None:
    cmd = [
        str(BLENDER), "--background", "--python", str(ROOT / "tools/blender/rig_biped.py"), "--",
        "--input", str(recon_glb), "--id", asset_id,
        "--race", race, "--unit", unit, "--role-class", role_class,
        "--height", str(height),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"rigging failed:\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}")


def render_preview(export_glb: Path, out_dir: Path) -> None:
    cmd = [str(BLENDER), "--background", "--python", str(ROOT / "tools/blender/render_glb_preview.py"), "--", str(export_glb), str(out_dir)]
    subprocess.run(cmd, capture_output=True, text=True)


def main() -> None:
    args = parse_args()
    INCOMING.mkdir(parents=True, exist_ok=True)

    pending = sorted(p for p in INCOMING.glob("*.png"))
    results = {"done": [], "skipped_no_rig": [], "skipped_exists": [], "failed": [], "unresolved": []}

    processed = 0
    for image_path in pending:
        if args.limit and processed >= args.limit:
            break

        resolved = resolve_race_unit(image_path.name)
        if not resolved:
            results["unresolved"].append(image_path.name)
            continue
        race, unit = resolved
        asset_id = f"{race}-{unit}-rigged-v1"
        manifest_path = MANIFESTS / f"{asset_id}.model.json"
        if manifest_path.exists():
            results["skipped_exists"].append(asset_id)
            continue

        unit_def = load_unit_def(race, unit)
        if not unit_def:
            results["unresolved"].append(f"{image_path.name} (unit '{unit}' not found in {race}.race.json)")
            continue
        archetype = unit_def["archetype"]

        print(f"--- {race}/{unit} ({archetype}) ---")
        try:
            reference_path = REFERENCES / f"{race}-{unit}-reference-v1.png"
            isolate_if_needed(image_path, reference_path)
            print(f"  reference -> {reference_path}")

            recon_glb = SOURCE / f"{race}-{unit}-reconstructed-v1.glb"
            info = reconstruct(reference_path, recon_glb, fast=args.fast)
            print(f"  reconstructed -> {recon_glb}  {info['stdout_tail']}")

            if archetype not in BIPED_ARCHETYPES:
                print(f"  [!] no rig archetype for '{archetype}' yet — mesh reconstructed only, skipping rig/export")
                results["skipped_no_rig"].append(f"{asset_id} ({archetype})")
                processed += 1
                continue

            height = HEIGHT_BY_ARCHETYPE.get(archetype, 1.9)
            rig_biped(recon_glb, asset_id, race, unit, archetype, height)
            export_glb = EXPORTS / f"{asset_id}.glb"
            print(f"  rigged -> {export_glb}")

            if not args.skip_preview:
                preview_dir = PREVIEWS / asset_id
                render_preview(export_glb, preview_dir)
                print(f"  preview -> {preview_dir}")

            results["done"].append(asset_id)
            processed += 1
        except Exception as exc:  # noqa: BLE001 — batch driver, one failure must not stop the rest
            print(f"  [FAILED] {exc}")
            results["failed"].append(f"{asset_id}: {exc}")
            processed += 1

    print("\n=== Summary ===")
    for key, items in results.items():
        print(f"{key}: {len(items)}")
        for item in items:
            print(f"  - {item}")


if __name__ == "__main__":
    main()
