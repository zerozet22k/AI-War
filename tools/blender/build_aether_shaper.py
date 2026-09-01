"""Build the production Aether Shaper as a rigged, animated GLB asset.

Run with Blender, not regular Python:
  blender --background --factory-startup --python tools/blender/build_aether_shaper.py

The result intentionally uses ordinary glTF PBR materials and skeletal
animation so Claude's C++ renderer can consume it with cgltf, fastgltf,
tinygltf, or Assimp without Blender-specific runtime features.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "3d" / "source"
EXPORT_DIR = ROOT / "art" / "3d" / "exports"
PREVIEW_DIR = ROOT / "art" / "3d" / "previews"
MANIFEST_DIR = ROOT / "art" / "3d" / "manifests"
for directory in (SOURCE_DIR, EXPORT_DIR, PREVIEW_DIR, MANIFEST_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def clean_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def material(
    name: str,
    base: tuple[float, float, float, float],
    *,
    metallic: float,
    roughness: float,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.36
        bsdf.inputs["Coat Roughness"].default_value = 0.12
    if emission is not None:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = emission
        if strength_input:
            strength_input.default_value = emission_strength
    return mat


def smooth_and_bevel(obj: bpy.types.Object, bevel: float = 0.04) -> None:
    if obj.type != "MESH":
        return
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("Edge micro-bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2


def skin_to_bone(obj: bpy.types.Object, rig: bpy.types.Object, bone: str) -> None:
    # Bake authored primitive orientation/scale into vertex positions before
    # adding an armature. Otherwise a rigidly weighted piece receives its
    # object rotation and its bone-space bind transform twice.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("Aether rig", "ARMATURE")
    modifier.object = rig
    # glTF importers expect the armature to be the parent of every skinned
    # primitive. Keeping world transforms preserves the authored rest pose.
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    obj["export_asset"] = True


def uv_part(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    *,
    segments: int = 40,
    rings: int = 24,
    bevel: float = 0.035,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    smooth_and_bevel(obj, bevel)
    skin_to_bone(obj, rig, bone)
    return obj


def segment_part(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius_start: float,
    radius_end: float,
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    *,
    vertices: int = 20,
) -> bpy.types.Object:
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    midpoint = (a + b) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    obj.data.materials.append(mat)
    smooth_and_bevel(obj, min(radius_start, radius_end) * 0.16)
    skin_to_bone(obj, rig, bone)
    return obj


def crystal_part(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    rotation: tuple[float, float, float],
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.58, radius2=0.06, depth=1.8, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    smooth_and_bevel(obj, 0.025)
    skin_to_bone(obj, rig, bone)
    return obj


def armor_plate(
    name: str,
    location: tuple[float, float, float],
    width: float,
    length: float,
    thickness: float,
    ridge: float,
    rotation: tuple[float, float, float],
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
) -> bpy.types.Object:
    """Create a hard-surface organic plate with a raised central keel."""
    outline = [
        (0.0, -0.52),
        (0.43, -0.38),
        (0.55, 0.06),
        (0.31, 0.48),
        (0.0, 0.58),
        (-0.31, 0.48),
        (-0.55, 0.06),
        (-0.43, -0.38),
    ]
    vertices: list[tuple[float, float, float]] = []
    for x, y in outline:
        vertices.append((x * width, y * length, -thickness * 0.5))
    for x, y in outline:
        shoulder = 1.0 - min(1.0, abs(x) * 1.5)
        vertices.append((x * width, y * length, thickness * 0.5 + ridge * shoulder))
    vertices.append((0, 0, thickness * 0.5 + ridge))
    top_center = 16
    faces: list[tuple[int, ...]] = []
    faces.append(tuple(range(7, -1, -1)))
    for i in range(8):
        nxt = (i + 1) % 8
        faces.append((i, nxt, 8 + nxt, 8 + i))
        faces.append((8 + i, 8 + nxt, top_center))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth_and_bevel(obj, min(width, length) * 0.035)
    skin_to_bone(obj, rig, bone)
    return obj


def create_rig() -> tuple[bpy.types.Object, dict[str, tuple[Vector, Vector]]]:
    armature = bpy.data.armatures.new("AetherShaper_Rig")
    rig = bpy.data.objects.new("AetherShaper_Rig", armature)
    bpy.context.collection.objects.link(rig)
    rig.show_in_front = True
    rig["export_asset"] = True
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bones: dict[str, tuple[Vector, Vector]] = {}

    def add_bone(name: str, head, tail, parent: str | None = None) -> None:
        edit = armature.edit_bones.new(name)
        edit.head = Vector(head)
        edit.tail = Vector(tail)
        if parent:
            edit.parent = armature.edit_bones[parent]
        bones[name] = (Vector(head), Vector(tail))

    add_bone("Root", (0, 0, 0.12), (0, 0, 0.62))
    add_bone("Body", (0, 0.30, 0.82), (0, -0.35, 1.58), "Root")
    add_bone("Head", (0, -0.72, 1.34), (0, -2.28, 1.02), "Body")
    add_bone("Carapace", (0, 0.45, 1.48), (0, 1.82, 1.62), "Body")

    leg_layout = {
        "Front": (-0.96, -0.88, 1.18, 2.05, -1.62, 0.73, 2.82, -2.28, 0.34),
        "Middle": (-1.18, 0.05, 1.10, 2.30, 0.18, 0.58, 3.00, -0.14, 0.26),
        "Rear": (-1.03, 0.93, 1.15, 2.08, 1.58, 0.62, 2.70, 2.18, 0.30),
    }
    for side, sign in (("L", 1.0), ("R", -1.0)):
        for label, values in leg_layout.items():
            sx, sy, sz, kx, ky, kz, fx, fy, fz = values
            shoulder = (abs(sx) * sign, sy, sz)
            knee = (kx * sign, ky, kz)
            foot = (fx * sign, fy, fz)
            upper = f"Leg_{side}_{label}_Upper"
            lower = f"Leg_{side}_{label}_Lower"
            add_bone(upper, shoulder, knee, "Body")
            add_bone(lower, knee, foot, upper)

    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig, bones


def build_model(rig: bpy.types.Object, bones: dict[str, tuple[Vector, Vector]]) -> list[bpy.types.Object]:
    chitin = material("Chitin_PBR", (0.010, 0.003, 0.026, 1), metallic=0.34, roughness=0.30)
    plate = material("Carapace_PBR", (0.038, 0.006, 0.090, 1), metallic=0.58, roughness=0.23)
    tissue = material("Organic_Underbody", (0.004, 0.002, 0.012, 1), metallic=0.03, roughness=0.52)
    crystal = material(
        "Aether_Crystal",
        (0.005, 0.26, 0.48, 1),
        metallic=0.20,
        roughness=0.08,
        emission=(0.0, 0.72, 1.0, 1),
        emission_strength=1.7,
    )
    eye = material(
        "Aether_Eyes",
        (0.0, 0.42, 0.72, 1),
        metallic=0.12,
        roughness=0.05,
        emission=(0.0, 0.92, 1.0, 1),
        emission_strength=3.4,
    )

    objects: list[bpy.types.Object] = []
    objects += [
        uv_part("Body_Core", (0, 0.25, 1.20), (1.12, 1.68, 0.62), tissue, rig, "Body", segments=48, rings=28),
        uv_part("Head_Core", (0, -1.38, 1.08), (0.86, 1.12, 0.54), chitin, rig, "Head", segments=48, rings=28),
        uv_part("Rear_Core", (0, 1.08, 1.42), (1.02, 1.02, 0.38), tissue, rig, "Carapace", segments=40, rings=22),
    ]

    # Overlapping keeled armor replaces the toy-like smooth shell. Each plate
    # has a distinct silhouette and catches the rim light along hard edges.
    body_plates = [
        ("Thorax_Plate", (0, -0.42, 1.60), 2.20, 1.10, 0.12, 0.26, "Body"),
        ("Mid_Plate", (0, 0.34, 1.68), 2.34, 1.16, 0.13, 0.30, "Carapace"),
        ("Rear_Plate", (0, 1.08, 1.70), 2.12, 1.18, 0.12, 0.31, "Carapace"),
        ("Tail_Plate", (0, 1.72, 1.61), 1.56, 0.92, 0.10, 0.24, "Carapace"),
    ]
    for name, loc, width, length, thick, ridge, bone in body_plates:
        objects.append(armor_plate(name, loc, width, length, thick, ridge, (0, 0, 0), plate, rig, bone))

    head_plates = [
        ("Head_Crown", (0, -1.18, 1.55), 1.74, 1.05, 0.11, 0.27),
        ("Head_Brow", (0, -1.76, 1.42), 1.42, 0.84, 0.10, 0.24),
        ("Head_Snout", (0, -2.18, 1.20), 0.92, 0.72, 0.08, 0.18),
    ]
    for name, loc, width, length, thick, ridge in head_plates:
        objects.append(armor_plate(name, loc, width, length, thick, ridge, (math.radians(-8), 0, 0), plate, rig, "Head"))

    # Six segmented locomotion limbs with armored joints and crystal ground blades.
    for side in ("L", "R"):
        for label in ("Front", "Middle", "Rear"):
            upper_name = f"Leg_{side}_{label}_Upper"
            lower_name = f"Leg_{side}_{label}_Lower"
            shoulder, knee = bones[upper_name]
            _, foot = bones[lower_name]
            objects.append(segment_part(f"{upper_name}_Mesh", shoulder, knee, 0.27, 0.20, chitin, rig, upper_name))
            objects.append(segment_part(f"{lower_name}_Mesh", knee, foot, 0.22, 0.13, chitin, rig, lower_name))
            objects.append(uv_part(f"{upper_name}_Joint", tuple(knee), (0.27, 0.27, 0.23), chitin, rig, upper_name, segments=24, rings=16, bevel=0.018))
            upper_direction = (knee - shoulder).normalized()
            upper_rotation = upper_direction.to_track_quat("Y", "Z").to_euler()
            lower_direction = (foot - knee).normalized()
            lower_rotation = lower_direction.to_track_quat("Y", "Z").to_euler()
            objects.append(armor_plate(f"{upper_name}_Armor", tuple((shoulder + knee) * 0.5 + Vector((0, 0, 0.10))), 0.54, (knee - shoulder).length * 0.72, 0.08, 0.11, tuple(upper_rotation), plate, rig, upper_name))
            objects.append(armor_plate(f"{lower_name}_Armor", tuple((knee + foot) * 0.5 + Vector((0, 0, 0.08))), 0.44, (foot - knee).length * 0.64, 0.07, 0.09, tuple(lower_rotation), plate, rig, lower_name))
            direction = (foot - knee).normalized()
            blade_center = foot + direction * 0.32 + Vector((0, -0.16, 0.06))
            blade_rotation = direction.to_track_quat("Z", "Y").to_euler()
            objects.append(crystal_part(f"{lower_name}_CrystalBlade", tuple(blade_center), (0.34, 0.34, 0.72), tuple(blade_rotation), crystal, rig, lower_name))

    # Crown crystals and facial energy organs.
    crown_specs = [
        ((0, 0.95, 2.14), (0.34, 0.34, 0.92), (0.05, 0.0, 0.0)),
        ((0.55, 0.70, 2.02), (0.25, 0.25, 0.64), (0.13, 0.22, -0.08)),
        ((-0.55, 0.70, 2.02), (0.25, 0.25, 0.64), (0.13, -0.22, 0.08)),
        ((0.78, 0.15, 1.86), (0.20, 0.20, 0.48), (0.12, 0.38, -0.12)),
        ((-0.78, 0.15, 1.86), (0.20, 0.20, 0.48), (0.12, -0.38, 0.12)),
    ]
    for index, (loc, scale, rot) in enumerate(crown_specs):
        objects.append(crystal_part(f"Crown_Crystal_{index}", loc, scale, rot, crystal, rig, "Carapace"))

    for side in (-1, 1):
        for index, y in enumerate((-1.82, -1.52, -1.22)):
            objects.append(uv_part(f"Eye_{side}_{index}", (side * (0.30 + index * 0.13), y, 1.47 - index * 0.09), (0.13, 0.09, 0.11), eye, rig, "Head", segments=24, rings=14, bevel=0.0))

    # Paired precision manipulators below the head distinguish the worker role.
    for side, sign in (("L", 1.0), ("R", -1.0)):
        start = Vector((0.36 * sign, -1.92, 1.00))
        end = Vector((0.82 * sign, -2.72, 0.72))
        objects.append(segment_part(f"Manipulator_{side}", start, end, 0.14, 0.07, tissue, rig, "Head", vertices=16))
        rot = (end - start).normalized().to_track_quat("Z", "Y").to_euler()
        objects.append(crystal_part(f"Manipulator_{side}_Tool", tuple(end + Vector((0, -0.24, 0))), (0.22, 0.22, 0.46), tuple(rot), crystal, rig, "Head"))

    return objects


def reset_pose(rig: bpy.types.Object) -> None:
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def key_pose(
    rig: bpy.types.Object,
    frame: int,
    rotations: dict[str, tuple[float, float, float]] | None = None,
    locations: dict[str, tuple[float, float, float]] | None = None,
    scales: dict[str, tuple[float, float, float]] | None = None,
) -> None:
    reset_pose(rig)
    for name, value in (rotations or {}).items():
        rig.pose.bones[name].rotation_euler = value
    for name, value in (locations or {}).items():
        rig.pose.bones[name].location = value
    for name, value in (scales or {}).items():
        rig.pose.bones[name].scale = value
    for bone in rig.pose.bones:
        bone.keyframe_insert("location", frame=frame, group=bone.name)
        bone.keyframe_insert("rotation_euler", frame=frame, group=bone.name)
        bone.keyframe_insert("scale", frame=frame, group=bone.name)


def make_action(rig: bpy.types.Object, name: str, frames: list[tuple[int, dict, dict, dict]], end: int) -> bpy.types.Action:
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame, rotations, locations, scales in frames:
        key_pose(rig, frame, rotations, locations, scales)
    # Blender 5 uses layered/slotted actions rather than exposing the legacy
    # Action.fcurves collection. keyframe_insert already writes into the
    # active action slot; leave its interpolation at Blender's smooth default
    # so this exporter works in both the 4.x and 5.x action systems.
    try:
        action.use_frame_range = True
        action.frame_start = 0
        action.frame_end = end
    except AttributeError:
        pass
    return action


def create_animations(rig: bpy.types.Object) -> list[bpy.types.Action]:
    rad = math.radians
    leg_names = [f"Leg_{side}_{label}" for side in ("L", "R") for label in ("Front", "Middle", "Rear")]

    idle = make_action(
        rig,
        "Idle",
        [
            (0, {}, {"Body": (0, 0, 0)}, {"Body": (1, 1, 1)}),
            (30, {"Head": (rad(2), 0, 0)}, {"Body": (0, 0, 0.055)}, {"Body": (1.018, 1.018, 0.97)}),
            (60, {}, {"Body": (0, 0, 0)}, {"Body": (1, 1, 1)}),
        ],
        60,
    )

    def walk_pose(sign: float) -> dict[str, tuple[float, float, float]]:
        rotations: dict[str, tuple[float, float, float]] = {"Body": (0, 0, rad(2.5) * sign), "Head": (rad(-2), 0, rad(-1.5) * sign)}
        for side in ("L", "R"):
            side_sign = 1 if side == "L" else -1
            for index, label in enumerate(("Front", "Middle", "Rear")):
                phase = sign if (index + (0 if side == "L" else 1)) % 2 == 0 else -sign
                rotations[f"Leg_{side}_{label}_Upper"] = (rad(13) * phase, rad(5) * side_sign, rad(6) * phase * side_sign)
                rotations[f"Leg_{side}_{label}_Lower"] = (rad(-18) * phase, 0, rad(-4) * phase * side_sign)
        return rotations

    move = make_action(
        rig,
        "Move",
        [
            (0, walk_pose(1), {"Body": (0, 0, -0.02)}, {}),
            (6, {}, {"Body": (0, 0, 0.06)}, {}),
            (12, walk_pose(-1), {"Body": (0, 0, -0.02)}, {}),
            (18, {}, {"Body": (0, 0, 0.06)}, {}),
            (24, walk_pose(1), {"Body": (0, 0, -0.02)}, {}),
        ],
        24,
    )

    front_upper = ("Leg_L_Front_Upper", "Leg_R_Front_Upper")
    front_lower = ("Leg_L_Front_Lower", "Leg_R_Front_Lower")
    attack_windup = {name: (rad(-24), 0, rad(10 if "L" in name else -10)) for name in front_upper}
    attack_windup.update({name: (rad(34), 0, 0) for name in front_lower})
    attack_strike = {name: (rad(32), 0, rad(-7 if "L" in name else 7)) for name in front_upper}
    attack_strike.update({name: (rad(-46), 0, 0) for name in front_lower})

    attack = make_action(
        rig,
        "Attack",
        [
            (0, {}, {}, {}),
            (9, {**attack_windup, "Head": (rad(-12), 0, 0), "Body": (rad(3), 0, 0)}, {"Body": (0, 0.12, 0.06)}, {}),
            (15, {**attack_strike, "Head": (rad(16), 0, 0), "Body": (rad(-5), 0, 0)}, {"Body": (0, -0.18, -0.04)}, {}),
            (22, {}, {}, {}),
        ],
        22,
    )

    work = make_action(
        rig,
        "Work",
        [
            (0, {}, {}, {}),
            (12, {**attack_windup, "Head": (rad(7), 0, rad(4))}, {"Body": (0, -0.08, 0.02)}, {}),
            (24, {**attack_strike, "Head": (rad(13), 0, rad(-4))}, {"Body": (0, -0.16, -0.02)}, {}),
            (36, {**attack_windup, "Head": (rad(7), 0, rad(4))}, {"Body": (0, -0.08, 0.02)}, {}),
            (48, {}, {}, {}),
        ],
        48,
    )

    hit = make_action(
        rig,
        "Hit",
        [
            (0, {}, {}, {}),
            (4, {"Body": (rad(-11), rad(3), rad(7)), "Head": (rad(-18), 0, rad(-5))}, {"Root": (0, 0.18, 0.04)}, {}),
            (12, {}, {}, {}),
        ],
        12,
    )

    death_rotations: dict[str, tuple[float, float, float]] = {
        "Body": (rad(72), rad(-12), rad(18)),
        "Head": (rad(38), rad(8), rad(-22)),
        "Carapace": (rad(-12), 0, rad(10)),
    }
    for side in ("L", "R"):
        side_sign = 1 if side == "L" else -1
        for index, label in enumerate(("Front", "Middle", "Rear")):
            death_rotations[f"Leg_{side}_{label}_Upper"] = (rad(28 + index * 8), rad(10) * side_sign, rad((30 + index * 10) * side_sign))
            death_rotations[f"Leg_{side}_{label}_Lower"] = (rad(-62 + index * 5), 0, rad(-18 * side_sign))
    death = make_action(
        rig,
        "Death",
        [
            (0, {}, {}, {}),
            (10, {"Body": (rad(18), 0, rad(5)), "Head": (rad(12), 0, rad(-5))}, {"Root": (0, 0, -0.12)}, {}),
            (32, death_rotations, {"Root": (0, 0.22, -0.72)}, {"Body": (1.02, 1.02, 0.88)}),
            (48, death_rotations, {"Root": (0, 0.22, -0.78)}, {"Body": (1.02, 1.02, 0.86)}),
        ],
        48,
    )

    rig.animation_data.action = idle
    return [idle, move, attack, work, hit, death]


def point_camera(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_preview(rig: bpy.types.Object, action: bpy.types.Action) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.render.filepath = str(PREVIEW_DIR / "aether-shaper.png")
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.004, 0.006, 0.015)

    bpy.ops.object.camera_add(location=(7.7, -10.5, 7.4))
    camera = bpy.context.object
    camera.name = "Preview_Camera"
    camera.data.lens = 62
    point_camera(camera, (0, -0.25, 1.08))
    scene.camera = camera

    def area(name, location, energy, color, size):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        point_camera(light, (0, 0, 1.0))

    area("Key_Light", (5.5, -5.0, 8.0), 920, (0.46, 0.68, 1.0), 5.0)
    area("Violet_Rim", (-5.0, 2.0, 5.5), 680, (0.44, 0.08, 1.0), 4.0)
    area("Soft_Fill", (1.0, 5.5, 3.0), 420, (0.0, 0.55, 0.76), 4.0)

    rig.animation_data.action = action
    scene.frame_set(30)
    bpy.ops.render.render(write_still=True)


def export_asset(rig: bpy.types.Object, objects: list[bpy.types.Object], actions: list[bpy.types.Action]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig

    blend_path = SOURCE_DIR / "aether-shaper.blend"
    glb_path = EXPORT_DIR / "aether-shaper.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_materials="EXPORT",
        export_yup=True,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
    )

    manifest = {
        "id": "aether-shaper",
        "race": "aether",
        "unit": "shaper",
        "format": "glTF 2.0 binary",
        "source": "../source/aether-shaper.blend",
        "asset": "../exports/aether-shaper.glb",
        "upAxis": "+Y (glTF export)",
        "forwardAxis": "-Z",
        "unitScale": "1 Blender unit = 1 meter",
        "clips": [{"name": action.name, "start": 0, "end": int(action.frame_range[1]), "fps": 30} for action in actions],
        "materials": ["Chitin_PBR", "Carapace_PBR", "Organic_Underbody", "Aether_Crystal", "Aether_Eyes"],
        "notes": "Animation names are stable API. Prefer root motion disabled; gameplay owns translation and facing.",
    }
    (MANIFEST_DIR / "aether-shaper.model.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def main() -> None:
    clean_scene()
    rig, bones = create_rig()
    objects = build_model(rig, bones)
    actions = create_animations(rig)
    setup_preview(rig, actions[0])
    export_asset(rig, objects, actions)
    print(f"Built {EXPORT_DIR / 'aether-shaper.glb'} with clips: {', '.join(action.name for action in actions)}")


if __name__ == "__main__":
    main()
