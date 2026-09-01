"""Render neutral turntable views of a GLB for art review."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def script_args() -> tuple[Path, Path, str | None, int]:
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) not in (2, 4):
        raise SystemExit("usage: blender --background --python render_glb_preview.py -- model.glb output-dir [action frame]")
    action = args[2] if len(args) == 4 else None
    frame = int(args[3]) if len(args) == 4 else 0
    return Path(args[0]).resolve(), Path(args[1]).resolve(), action, frame


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


source, output_dir, action_name, review_frame = script_args()
output_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise RuntimeError(f"No meshes found in {source}")

if action_name:
    action = bpy.data.actions.get(action_name)
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if action is None or not rigs:
        raise RuntimeError(f"Animation {action_name!r} was not imported from {source}")
    rigs[0].animation_data_create()
    rigs[0].animation_data.action = action
    bpy.context.scene.frame_set(review_frame)

for obj in meshes:
    for polygon in obj.data.polygons:
        polygon.use_smooth = True

corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
minimum = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
maximum = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
center = (minimum + maximum) * 0.5
scale = 3.2 / max(maximum - minimum)
for obj in meshes:
    obj.location = (obj.location - center) * scale
    obj.scale *= scale

# Recompute after normalization and place the lowest point on the ground.
corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
floor_z = min(v.z for v in corners)
for obj in meshes:
    obj.location.z -= floor_z

material = bpy.data.materials.new("Review_Chitin")
material.use_nodes = True
material.diffuse_color = (0.075, 0.018, 0.12, 1.0)
material.metallic = 0.42
material.roughness = 0.28
review_bsdf = material.node_tree.nodes.get("Principled BSDF")
review_bsdf.inputs["Base Color"].default_value = material.diffuse_color
review_bsdf.inputs["Metallic"].default_value = material.metallic
review_bsdf.inputs["Roughness"].default_value = material.roughness
for obj in meshes:
    obj.data.materials.clear()
    obj.data.materials.append(material)

bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
ground = bpy.context.object
ground_mat = bpy.data.materials.new("Review_Ground")
ground_mat.use_nodes = True
ground_mat.diffuse_color = (0.025, 0.03, 0.045, 1.0)
ground_mat.metallic = 0.05
ground_mat.roughness = 0.72
ground_bsdf = ground_mat.node_tree.nodes.get("Principled BSDF")
ground_bsdf.inputs["Base Color"].default_value = ground_mat.diffuse_color
ground_bsdf.inputs["Metallic"].default_value = ground_mat.metallic
ground_bsdf.inputs["Roughness"].default_value = ground_mat.roughness
ground.data.materials.append(ground_mat)

def area(name: str, location: tuple[float, float, float], energy: float, color: tuple[float, float, float], size: float) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    look_at(obj, Vector((0, 0, 1.5)))
    bpy.context.collection.objects.link(obj)


area("Key", (4.5, -5.5, 6.5), 1300, (0.72, 0.86, 1.0), 4.0)
area("Fill", (-5.0, -2.0, 3.5), 850, (0.55, 0.72, 1.0), 3.0)
area("Rim", (1.0, 5.0, 5.0), 1500, (0.72, 0.30, 1.0), 3.0)

camera_data = bpy.data.cameras.new("ReviewCamera")
camera = bpy.data.objects.new("ReviewCamera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera_data.lens = 58

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("ReviewWorld")
scene.world.color = (0.008, 0.012, 0.022)
target = Vector((0, 0, 1.55))

views = {
    "front": (0.0, -6.2, 3.3),
    "three-quarter": (4.4, -4.4, 3.3),
    "side": (6.2, 0.0, 3.3),
    "rear": (0.0, 6.2, 3.3),
}
for name, location in views.items():
    camera.location = location
    look_at(camera, target)
    suffix = f"-{action_name}-{review_frame}" if action_name else ""
    scene.render.filepath = str(output_dir / f"{name}{suffix}.png")
    bpy.ops.render.render(write_still=True)

print({"source": str(source), "output_dir": str(output_dir), "action": action_name, "frame": review_frame, "views": list(views)})
