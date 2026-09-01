"""Generalized humanoid-biped rig + animation, parameterized per unit.

Unlike rig_shaper.py (hand-tuned for one specific 6-legged creature), this
script takes a reconstructed mesh + a handful of CLI args and produces the
same clip contract (Idle, Move, Attack, Work, Hit, Death) on a generic
2-legged skeleton, proportioned as fractions of a target standing height.
Reusable for every biped-archetype unit (builder/soldier/scout/marksman/
support/rocketeer) across all three races.

Usage (from repo root, via the portable Blender):
  .tools/blender/app/blender-5.2.1-windows-x64/blender.exe --background \
    --python tools/blender/rig_biped.py -- \
    --input art/3d/source/<race>-<unit>-reconstructed-v1.glb \
    --id <race>-<unit>-rigged-v1 \
    --race <race> --unit <unit> --role-class <archetype> \
    --height 1.9 \
    --color 0.05,0.06,0.09,1 --metallic 0.3 --roughness 0.4
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--id", required=True, help="output asset id, e.g. ironclad-warden-rigged-v1")
    parser.add_argument("--race", required=True)
    parser.add_argument("--unit", required=True)
    parser.add_argument("--role-class", required=True, help="gameplay archetype, e.g. soldier")
    parser.add_argument("--height", type=float, default=1.9, help="standing height in meters")
    parser.add_argument("--color", default="0.05,0.05,0.07,1", help="r,g,b,a base material color 0..1")
    parser.add_argument("--metallic", type=float, default=0.3)
    parser.add_argument("--roughness", type=float, default=0.45)
    return parser.parse_args(argv)


def material(name: str, color, metallic: float, roughness: float, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    mat.metallic = metallic
    mat.roughness = roughness
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    if emission:
        emission_input = node.inputs.get("Emission Color") or node.inputs.get("Emission")
        strength_input = node.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = emission
        if strength_input:
            strength_input.default_value = strength
    return mat


def normalize_mesh(objects: list[bpy.types.Object], height: float) -> None:
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)

    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    minimum = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    maximum = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    center = (minimum + maximum) * 0.5
    span = maximum.z - minimum.z
    scale = height / span if span > 1e-6 else 1.0
    for obj in objects:
        obj.location = (obj.location - center) * scale
        obj.scale *= scale
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.select_set(False)

    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    floor_z = min(v.z for v in corners)
    for obj in objects:
        obj.location.z -= floor_z


def create_rig(height: float) -> bpy.types.Object:
    """Generic human-proportioned biped, bone coordinates as fractions of `height`."""
    h = height
    armature = bpy.data.armatures.new("Biped_Rig")
    rig = bpy.data.objects.new("Biped_Rig", armature)
    bpy.context.collection.objects.link(rig)
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def add(name: str, head, tail, parent: str | None = None):
        bone = armature.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent:
            bone.parent = armature.edit_bones[parent]
        return bone

    add("Root", (0, 0, 0.48 * h), (0, 0, 0.52 * h))
    add("Spine", (0, 0, 0.50 * h), (0, 0.01, 0.64 * h), "Root")
    add("Chest", (0, 0.01, 0.64 * h), (0, -0.01, 0.82 * h), "Spine")
    add("Head", (0, -0.01, 0.82 * h), (0, -0.06, 0.98 * h), "Chest")

    for side, sign in (("L", 1.0), ("R", -1.0)):
        shoulder = (0.14 * h * sign, 0, 0.80 * h)
        elbow = (0.22 * h * sign, 0.06 * h, 0.60 * h)
        hand = (0.24 * h * sign, 0.12 * h, 0.42 * h)
        add(f"Arm_{side}_Upper", shoulder, elbow, "Chest")
        add(f"Arm_{side}_Lower", elbow, hand, f"Arm_{side}_Upper")

        hip = (0.09 * h * sign, 0, 0.50 * h)
        knee = (0.09 * h * sign, 0.02 * h, 0.27 * h)
        foot = (0.09 * h * sign, -0.05 * h, 0.02 * h)
        add(f"Leg_{side}_Upper", hip, knee, "Root")
        add(f"Leg_{side}_Lower", knee, foot, f"Leg_{side}_Upper")

    bpy.ops.object.mode_set(mode="POSE")
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def bind_mesh(meshes: list[bpy.types.Object], rig: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def add_team_badge(mat, rig: bpy.types.Object, height: float) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=(0, -0.145 * height, 0.70 * height), scale=(0.09 * height, 0.018 * height, 0.09 * height))
    badge = bpy.context.object
    badge.name = "TEAMCOLOR_Badge_Chest"
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = badge.modifiers.new("Badge_Bevel", "BEVEL")
    bevel.width = 0.012 * height
    bevel.segments = 3
    bpy.context.view_layer.objects.active = badge
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    badge.data.materials.append(mat)
    badge.parent = rig
    modifier = badge.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    group = badge.vertex_groups.new(name="Chest")
    group.add(range(len(badge.data.vertices)), 1.0, "REPLACE")
    badge["team_color_binding"] = "primary"
    return badge


def reset_pose(rig: bpy.types.Object) -> None:
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def key_pose(rig, frame: int, rotations=None, locations=None) -> None:
    reset_pose(rig)
    for name, value in (rotations or {}).items():
        rig.pose.bones[name].rotation_euler = value
    for name, value in (locations or {}).items():
        rig.pose.bones[name].location = value
    for bone in rig.pose.bones:
        bone.keyframe_insert("location", frame=frame, group=bone.name)
        bone.keyframe_insert("rotation_euler", frame=frame, group=bone.name)


def make_action(rig, name: str, keys: list[tuple[int, dict, dict]], end: int):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame, rotations, locations in keys:
        key_pose(rig, frame, rotations, locations)
    try:
        action.use_frame_range = True
        action.frame_start = 0
        action.frame_end = end
    except AttributeError:
        pass
    return action


def create_actions(rig: bpy.types.Object):
    r = math.radians
    idle = make_action(
        rig,
        "Idle",
        [
            (0, {}, {}),
            (30, {"Chest": (r(1.2), 0, r(-1.0)), "Head": (r(-1.0), r(1.5), 0)}, {"Chest": (0, 0, 0.01)}),
            (60, {"Chest": (r(-1.0), 0, r(1.0)), "Head": (r(1.0), r(-1.5), 0)}, {}),
            (90, {"Chest": (r(0.8), 0, 0)}, {"Chest": (0, 0, 0.007)}),
            (120, {}, {}),
        ],
        120,
    )

    def gait(phase: float):
        rotations = {
            "Spine": (0, 0, r(2.5) * phase),
            "Chest": (0, 0, r(-1.5) * phase),
            "Head": (r(-1.0), 0, 0),
            "Leg_L_Upper": (r(24) * phase, 0, 0),
            "Leg_L_Lower": (r(-30) * max(0, -phase) if phase < 0 else r(-14) * phase, 0, 0),
            "Leg_R_Upper": (r(-24) * phase, 0, 0),
            "Leg_R_Lower": (r(-14) * -phase if phase < 0 else r(-30) * phase, 0, 0),
            "Arm_L_Upper": (r(-18) * phase, 0, 0),
            "Arm_R_Upper": (r(18) * phase, 0, 0),
        }
        return rotations

    move = make_action(
        rig,
        "Move",
        [
            (0, gait(1), {"Root": (0, 0, 0.0)}),
            (12, gait(0), {"Root": (0, 0, 0.035)}),
            (24, gait(-1), {"Root": (0, 0, 0.0)}),
            (36, gait(0), {"Root": (0, 0, 0.035)}),
            (48, gait(1), {"Root": (0, 0, 0.0)}),
        ],
        48,
    )

    work_reach = {"Arm_L_Upper": (r(-40), r(6), r(10)), "Arm_L_Lower": (r(35), 0, 0), "Head": (r(12), 0, 0), "Chest": (r(8), 0, 0)}
    work_press = {"Arm_L_Upper": (r(-15), r(6), r(-6)), "Arm_L_Lower": (r(10), 0, 0), "Head": (r(16), 0, 0), "Chest": (r(14), 0, 0)}
    work = make_action(rig, "Work", [(0, {}, {}), (18, work_reach, {}), (32, work_press, {}), (46, work_reach, {}), (64, work_press, {}), (72, {}, {})], 72)

    attack_raise = {"Arm_R_Upper": (r(-55), r(-8), r(4)), "Arm_R_Lower": (r(20), 0, 0), "Chest": (0, 0, r(-6)), "Head": (r(-4), 0, 0)}
    attack_fire = {"Arm_R_Upper": (r(-62), r(-8), r(4)), "Arm_R_Lower": (r(8), 0, 0), "Chest": (0, 0, r(-3)), "Head": (r(2), 0, 0)}
    attack = make_action(rig, "Attack", [(0, {}, {}), (8, attack_raise, {}), (14, attack_fire, {"Root": (0, 0.03, 0)}), (22, attack_raise, {}), (30, {}, {})], 30)

    hit = make_action(rig, "Hit", [(0, {}, {}), (5, {"Chest": (r(-8), r(4), r(6)), "Head": (r(-14), 0, r(-6))}, {"Root": (0, 0.05, 0)}), (14, {"Chest": (r(3), r(-1), r(-2))}, {}), (24, {}, {})], 24)

    death_pose = {
        "Spine": (r(48), r(6), r(10)),
        "Chest": (r(35), r(8), r(16)),
        "Head": (r(30), r(-10), r(-20)),
        "Arm_L_Upper": (r(20), r(30), 0),
        "Arm_R_Upper": (r(20), r(-30), 0),
        "Leg_L_Upper": (r(-15), 0, r(10)),
        "Leg_R_Upper": (r(-15), 0, r(-10)),
    }
    death = make_action(
        rig,
        "Death",
        [(0, {}, {}), (12, {"Chest": (r(10), 0, r(4)), "Head": (r(12), 0, r(-4))}, {"Root": (0, 0.06, -0.05)}), (50, death_pose, {"Root": (0, 0.22, -0.42)}), (80, death_pose, {"Root": (0, 0.24, -0.46)})],
        80,
    )

    rig.animation_data.action = idle
    return [idle, move, work, attack, hit, death]


def main() -> None:
    args = parse_args()
    color = tuple(float(c) for c in args.color.split(","))

    blend = ROOT / "art/3d/source" / f"{args.id}.blend"
    export = ROOT / "art/3d/exports" / f"{args.id}.glb"
    manifest = ROOT / "art/3d/manifests" / f"{args.id}.model.json"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.input))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No meshes found in {args.input}")
    normalize_mesh(meshes, args.height)

    body_mat = material(f"{args.id}_Body_PBR", color, args.metallic, args.roughness)
    team_badge = material("TeamColor_Badge", (0.035, 0.22, 0.95, 1), 0.55, 0.20, (0.02, 0.16, 0.8, 1), 0.75)
    team_badge["team_color_binding"] = "primary"
    for mesh in meshes:
        mesh.data.materials.clear()
        mesh.data.materials.append(body_mat)
        for face in mesh.data.polygons:
            face.use_smooth = True

    rig = create_rig(args.height)
    bind_mesh(meshes, rig)
    badge = add_team_badge(team_badge, rig, args.height)

    actions = create_actions(rig)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 0
    scene.frame_end = 120

    blend.parent.mkdir(parents=True, exist_ok=True)
    export.parent.mkdir(parents=True, exist_ok=True)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))

    bpy.ops.object.select_all(action="DESELECT")
    for obj in [*meshes, badge, rig]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(export),
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

    manifest.write_text(
        json.dumps(
            {
                "id": args.id,
                "race": args.race,
                "unit": args.unit,
                "roleClass": args.role_class,
                "rigArchetype": "biped",
                "source": f"../source/{args.id}.blend",
                "asset": f"../exports/{args.id}.glb",
                "reference": f"../references/{args.race}-{args.unit}-reference-v1.png",
                "scaleMeters": args.height,
                "upAxis": "+Y (glTF)",
                "forwardAxis": "-Z",
                "rootMotion": False,
                "teamColor": {
                    "material": "TeamColor_Badge",
                    "objectPrefix": "TEAMCOLOR_",
                    "binding": "primary",
                    "policy": "badge-only; never tint the full race material",
                },
                "clips": [{"name": action.name, "fps": 30, "frames": [0, int(action.frame_range[1])]} for action in actions],
                "status": "rigged base; final retopology and texture bake still required",
                "provenance": "Base geometry reconstructed with Tencent Hunyuan3D-2mini; Blender rig and clips authored locally (generic biped archetype).",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print({"blend": str(blend), "glb": str(export), "clips": [a.name for a in actions]})


if __name__ == "__main__":
    main()
