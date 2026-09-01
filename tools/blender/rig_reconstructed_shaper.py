"""Turn the reconstructed Aether Shaper base mesh into a game-ready animated GLB.

The mesh is reconstructed offline; all rigging and clip authoring in this file is
deterministic and can be repeated by Claude or a build machine with Blender.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "art/3d/source/aether-shaper-reconstructed-v1.glb"
BLEND = ROOT / "art/3d/source/aether-shaper-rigged-v1.blend"
EXPORT = ROOT / "art/3d/exports/aether-shaper-rigged-v1.glb"
MANIFEST = ROOT / "art/3d/manifests/aether-shaper-rigged-v1.model.json"


def material(name: str, color: tuple[float, float, float, float], metallic: float, roughness: float, emission=None, strength=0.0):
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


def normalize_mesh(objects: list[bpy.types.Object], height: float = 3.2) -> None:
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)

    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    minimum = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    maximum = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    center = (minimum + maximum) * 0.5
    scale = height / (maximum.z - minimum.z)
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


def create_rig() -> bpy.types.Object:
    armature = bpy.data.armatures.new("AetherShaper_Rig")
    rig = bpy.data.objects.new("AetherShaper_Rig", armature)
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

    add("Root", (0, 0, 0.08), (0, 0, 0.48))
    add("Abdomen", (0, 0.18, 0.55), (0, 0.10, 1.35), "Root")
    add("Thorax", (0, 0.10, 1.25), (0, -0.03, 2.18), "Abdomen")
    add("Head", (0, -0.03, 2.10), (0, -0.28, 2.92), "Thorax")

    legs = {
        "Front": ((0.35, -0.18, 1.55), (0.92, -0.48, 0.92), (1.18, -0.68, 0.08)),
        "Middle": ((0.42, 0.02, 1.30), (1.05, 0.00, 0.72), (1.30, -0.02, 0.08)),
        "Rear": ((0.35, 0.24, 1.12), (0.86, 0.62, 0.62), (1.02, 0.92, 0.08)),
    }
    for side, sign in (("L", 1.0), ("R", -1.0)):
        for label, (root, knee, foot) in legs.items():
            mirrored = lambda point: (point[0] * sign, point[1], point[2])
            upper = f"Leg_{side}_{label}_Upper"
            add(upper, mirrored(root), mirrored(knee), "Thorax")
            add(f"Leg_{side}_{label}_Lower", mirrored(knee), mirrored(foot), upper)

        shoulder = (0.31 * sign, -0.22, 2.24)
        elbow = (0.74 * sign, -0.48, 1.91)
        tool = (0.93 * sign, -0.70, 1.60)
        upper = f"Manipulator_{side}_Upper"
        add(upper, shoulder, elbow, "Thorax")
        add(f"Manipulator_{side}_Lower", elbow, tool, upper)

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


def add_eye(name: str, location, scale, mat, rig: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=location)
    eye = bpy.context.object
    eye.name = name
    eye.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    eye.data.materials.append(mat)
    eye.parent = rig
    modifier = eye.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    group = eye.vertex_groups.new(name="Head")
    group.add(range(len(eye.data.vertices)), 1.0, "REPLACE")
    for face in eye.data.polygons:
        face.use_smooth = True
    return eye


def add_team_badge(mat, rig: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=(0, -0.655, 2.17), scale=(0.15, 0.028, 0.15))
    badge = bpy.context.object
    badge.name = "TEAMCOLOR_Badge_Thorax"
    badge.rotation_euler.y = math.radians(45)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = badge.modifiers.new("Badge_Bevel", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 3
    bpy.context.view_layer.objects.active = badge
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    badge.data.materials.append(mat)
    badge.parent = rig
    modifier = badge.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    group = badge.vertex_groups.new(name="Thorax")
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
            (30, {"Head": (r(1.8), r(-1.2), r(2.0)), "Abdomen": (r(-1.2), 0, r(-0.8))}, {"Thorax": (0, 0, 0.025)}),
            (60, {"Head": (r(-1.2), r(1.0), r(-2.4)), "Abdomen": (r(1.0), 0, r(0.8))}, {}),
            (90, {"Head": (r(1.0), r(-0.5), r(1.0))}, {"Thorax": (0, 0, 0.018)}),
            (120, {}, {}),
        ],
        120,
    )

    def gait(phase: float):
        rotations = {"Thorax": (0, r(1.5) * phase, r(1.2) * phase), "Head": (r(-1.5), 0, r(-1.2) * phase)}
        for side_index, side in enumerate(("L", "R")):
            side_sign = 1 if side == "L" else -1
            for leg_index, label in enumerate(("Front", "Middle", "Rear")):
                stride = phase if (side_index + leg_index) % 2 == 0 else -phase
                rotations[f"Leg_{side}_{label}_Upper"] = (r(18) * stride, r(6) * side_sign, r(5) * stride * side_sign)
                rotations[f"Leg_{side}_{label}_Lower"] = (r(-25) * stride, 0, r(-4) * stride * side_sign)
        return rotations

    move = make_action(
        rig,
        "Move",
        [
            (0, gait(1), {"Root": (0, 0, -0.02)}),
            (12, gait(0), {"Root": (0, 0, 0.055)}),
            (24, gait(-1), {"Root": (0, 0, -0.02)}),
            (36, gait(0), {"Root": (0, 0, 0.055)}),
            (48, gait(1), {"Root": (0, 0, -0.02)}),
        ],
        48,
    )

    work_reach = {
        "Manipulator_L_Upper": (r(-28), r(-8), r(18)),
        "Manipulator_L_Lower": (r(42), 0, r(-10)),
        "Manipulator_R_Upper": (r(-28), r(8), r(-18)),
        "Manipulator_R_Lower": (r(42), 0, r(10)),
        "Head": (r(10), 0, 0),
    }
    work_press = {
        "Manipulator_L_Upper": (r(19), r(-4), r(-12)),
        "Manipulator_L_Lower": (r(-35), 0, r(8)),
        "Manipulator_R_Upper": (r(19), r(4), r(12)),
        "Manipulator_R_Lower": (r(-35), 0, r(-8)),
        "Head": (r(15), 0, 0),
    }
    work = make_action(rig, "Work", [(0, {}, {}), (18, work_reach, {"Thorax": (0, -0.07, 0.03)}), (32, work_press, {"Thorax": (0, -0.16, -0.02)}), (46, work_reach, {"Thorax": (0, -0.07, 0.03)}), (64, work_press, {"Thorax": (0, -0.16, -0.02)}), (72, {}, {})], 72)

    attack = make_action(
        rig,
        "Attack",
        [
            (0, {}, {}),
            (10, {**work_reach, "Head": (r(-14), 0, 0), "Thorax": (r(-5), 0, 0)}, {"Root": (0, 0.10, 0.04)}),
            (17, {**work_press, "Head": (r(18), 0, 0), "Thorax": (r(8), 0, 0)}, {"Root": (0, -0.17, -0.03)}),
            (36, {}, {}),
        ],
        36,
    )

    hit = make_action(rig, "Hit", [(0, {}, {}), (5, {"Thorax": (r(-10), r(5), r(9)), "Head": (r(-18), 0, r(-8))}, {"Root": (0, 0.16, 0.04)}), (14, {"Thorax": (r(3), r(-2), r(-3))}, {}), (24, {}, {})], 24)

    death_pose = {"Abdomen": (r(55), r(-8), r(14)), "Thorax": (r(42), r(10), r(22)), "Head": (r(35), r(-12), r(-28))}
    for side_index, side in enumerate(("L", "R")):
        side_sign = 1 if side == "L" else -1
        for index, label in enumerate(("Front", "Middle", "Rear")):
            death_pose[f"Leg_{side}_{label}_Upper"] = (r(26 + index * 7), r(8) * side_sign, r((28 + index * 8) * side_sign))
            death_pose[f"Leg_{side}_{label}_Lower"] = (r(-58 + index * 4), 0, r(-16 * side_sign))
    death = make_action(rig, "Death", [(0, {}, {}), (14, {"Thorax": (r(12), 0, r(4)), "Head": (r(14), 0, r(-5))}, {"Root": (0, 0.10, -0.08)}), (58, death_pose, {"Root": (0, 0.32, -0.68)}), (90, death_pose, {"Root": (0, 0.34, -0.74)})], 90)

    rig.animation_data.action = idle
    return [idle, move, work, attack, hit, death]


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(INPUT))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    normalize_mesh(meshes)

    chitin = material("Aether_Chitin_PBR", (0.105, 0.012, 0.165, 1), 0.38, 0.27)
    eyes = material("Aether_Eye_Emission", (0.0, 0.34, 0.72, 1), 0.15, 0.08, (0.0, 0.82, 1.0, 1), 3.0)
    team_badge = material("TeamColor_Badge", (0.035, 0.22, 0.95, 1), 0.55, 0.20, (0.02, 0.16, 0.8, 1), 0.75)
    team_badge["team_color_binding"] = "primary"
    for mesh in meshes:
        mesh.name = "AetherShaper_Body"
        mesh.data.name = "AetherShaper_Body_Mesh"
        mesh.data.materials.clear()
        mesh.data.materials.append(chitin)
        for face in mesh.data.polygons:
            face.use_smooth = True

    rig = create_rig()
    bind_mesh(meshes, rig)

    eye_objects = []
    for side in (-1, 1):
        eye_objects.extend(
            [
                add_eye(f"Eye_{side}_Upper", (0.18 * side, -0.64, 2.76), (0.085, 0.035, 0.12), eyes, rig),
                add_eye(f"Eye_{side}_Middle", (0.27 * side, -0.61, 2.62), (0.10, 0.035, 0.13), eyes, rig),
                add_eye(f"Eye_{side}_Lower", (0.22 * side, -0.62, 2.47), (0.085, 0.035, 0.11), eyes, rig),
            ]
        )
    badge = add_team_badge(team_badge, rig)

    actions = create_actions(rig)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 0
    scene.frame_end = 120

    BLEND.parent.mkdir(parents=True, exist_ok=True)
    EXPORT.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    bpy.ops.object.select_all(action="DESELECT")
    for obj in [*meshes, *eye_objects, badge, rig]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(EXPORT),
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

    MANIFEST.write_text(
        json.dumps(
            {
                "id": "aether-shaper-rigged-v1",
                "race": "aether",
                "unit": "shaper",
                "roleClass": "builder",
                "source": "../source/aether-shaper-rigged-v1.blend",
                "asset": "../exports/aether-shaper-rigged-v1.glb",
                "reference": "../references/aether-shaper-reconstruction-v1.png",
                "referencePrompt": "../references/aether-shaper-reference-v1.prompt.txt",
                "scaleMeters": 3.2,
                "upAxis": "+Y (glTF)",
                "forwardAxis": "-Z",
                "rootMotion": False,
                "teamColor": {
                    "material": "TeamColor_Badge",
                    "objectPrefix": "TEAMCOLOR_",
                    "binding": "primary",
                    "policy": "badge-only; never tint the full race material"
                },
                "clips": [{"name": action.name, "fps": 30, "frames": [0, int(action.frame_range[1])]} for action in actions],
                "status": "rigged base; final retopology and texture bake still required",
                "provenance": "Base geometry reconstructed with Tencent Hunyuan3D-2mini; Blender rig and clips authored locally.",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print({"blend": str(BLEND), "glb": str(EXPORT), "clips": [action.name for action in actions]})


if __name__ == "__main__":
    main()
