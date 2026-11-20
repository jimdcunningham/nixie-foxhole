"""Export rigid wheel groups around the authored bogie or axle pivots."""
import bmesh
import bpy
import re
from mathutils import Vector

SMALL_GAUGE = ("smalltrainengine", "smalltrainliquid", "smalltrainmaterial", "smalltrainresource", "smalltrainshipping")

# Each family shares the same pivot names. Shaft/rod children of those
# pivots follow the wheels, while the chassis keeps its independently baked pose.
PIVOTS = {
    "trainengine": (None, "BogieBack"),
    "traincoal": ("Bogie_Front", "Bogie_Back"),
    "trainhospital": ("FAxis_PIVOT", "RAxis_PIVOT"),
    "trainlrartillery": ("FrontAxle_PIVOT", "BackAxle_PIVOT"),
    **dict.fromkeys(("traincaboose", "traincombatcarc", "traincombatcarw", "trainflatbed", "traininfantry"),
                    ("frontAxle_PIVOT", "backAxle_PIVOT")),
    **dict.fromkeys(SMALL_GAUGE, ("Wheel_F", "Wheel_B")),
}
NAMES = ("rail-bogie-front", "rail-bogie-rear")
WHEEL_PATTERNS = {
    "trainengine": re.compile(r"wheel_(1|2|3|back)_[lr]$", re.IGNORECASE),
    "trainlrartillery": re.compile(r"wheel(0[1-3]_(?:front|back))_[lr]$", re.IGNORECASE),
    "traincoal": re.compile(r"wheel_(front|back)_[lr]$", re.IGNORECASE),
    "trainhospital": re.compile(r"wheel([12]_[fr])$", re.IGNORECASE),
    **dict.fromkeys(("traincaboose", "traincombatcarc", "traincombatcarw", "trainflatbed", "traininfantry"),
                    re.compile(r"wheel_(front_[12]|back_[12])_[lr]$", re.IGNORECASE)),
    **dict.fromkeys(SMALL_GAUGE, re.compile(r"wheel_([fb])_[lr]$", re.IGNORECASE)),
}
ENGINE_LINKS = {
    "wheelconnection": "coupling",
    "connectingrod": "rod",
    "lowerpiston": "slider",
    "wheelflyingcrank": "return-crank",
    "eccentricrod": "eccentric",
    "expansionlink": "expansion",
    "radiusrod": "radius",
    "unionlink": "union",
    "combinationlink": "combination",
    "combinationlink_head": "combination-head",
    "upperpiston": "valve-stem",
    "liftinglink": "hanger-upper",
    "liftinglink_end": "hanger-lower",
}
SMALL_ENGINE_LINKS = {
    "connectionrod02": "small-coupling",
    "mainrod": "small-rod",
    "piston01": "small-piston",
    "piston02": "small-valve-stem",
    "liftinglinkbottom": "small-lifting-link",
    "liftinglink": "small-upper-link",
    "bellcrank": "small-bell-crank",
}
# The source bones for these two meshes sit away from their visible hinge pins.
# Recenter the exported pivots on the metal joints, in Blender X/Z metres.
SMALL_ENGINE_LINK_PIVOT_OFFSETS = {
    "liftinglinkbottom": (-0.003816, 0, 0.016779),
    "liftinglink": (0.181298, 0, 0.181296),
}
# The source shaft tips end flush with the cylinder mouths at rest. Extend
# only those caps so the shafts remain inside the cylinders at full withdrawal.
# The runtime gear retracts the lower shaft by 0.093 m and the upper by 0.0004 m.
SMALL_ENGINE_SHAFT_EXTENSIONS = {"small-piston": 0.115, "small-valve-stem": 0.012}


def split_rail_bogies(asset_id, meshes, collection, ground):
    if asset_id not in PIVOTS:
        return meshes, []
    output, parts, part_parents = [], [], {}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in meshes:
        modifier = next((m for m in obj.modifiers if m.type == "ARMATURE" and m.object), None)
        if modifier is None:
            output.append(obj)
            continue
        armature = modifier.object
        pivots = {bone.casefold(): name for name, bone in zip(NAMES, PIVOTS[asset_id]) if bone}
        pivots_by_name = {pivots[bone.name.casefold()]: armature.matrix_world @ bone.head
                          for bone in armature.pose.bones if bone.name.casefold() in pivots}
        if not pivots_by_name:
            output.append(obj)
            continue
        wheel_pattern = WHEEL_PATTERNS.get(asset_id)
        wheels = {}
        if wheel_pattern:
            wheel_centres = {}
            for bone in armature.pose.bones:
                match = wheel_pattern.fullmatch(bone.name)
                if not match:
                    continue
                name = "rail-wheel-" + match[1].lower().replace("_", "-")
                wheels[bone.name] = name
                wheel_centres.setdefault(name, []).append(armature.matrix_world @ bone.head)
                ancestor = bone.parent
                while ancestor and ancestor.name.casefold() not in pivots:
                    ancestor = ancestor.parent
                part_parents[name] = pivots[ancestor.name.casefold()] if ancestor else "rail-body"
            for name, centres in wheel_centres.items():
                pivots_by_name[name] = sum(centres, Vector((0, 0, 0))) / len(centres)
        links = {}
        link_types = ENGINE_LINKS if asset_id == "trainengine" else SMALL_ENGINE_LINKS if asset_id == "smalltrainengine" else {}
        if link_types:
            for bone in armature.pose.bones:
                kind, _, side = bone.name.casefold().rpartition("_")
                if asset_id == "smalltrainengine" and kind in ("mainconnectionrod", "mainconnectionrodhead"):
                    # The return cranks turn with the powered axle.
                    wheels[bone.name] = "rail-wheel-b"
                    continue
                if kind not in link_types or side not in ("l", "r"):
                    continue
                name = f"rail-link-{link_types[kind]}-{side}"
                links[bone.name] = name
                pivots_by_name[name] = armature.matrix_world @ bone.head
                if asset_id == "smalltrainengine" and kind in SMALL_ENGINE_LINK_PIVOT_OFFSETS:
                    pivots_by_name[name] += Vector(SMALL_ENGINE_LINK_PIVOT_OFFSETS[kind])
                part_parents[name] = "rail-body"
        groups = {}
        for vertex_group in obj.vertex_groups:
            if vertex_group.name in links:
                groups[vertex_group.index] = links[vertex_group.name]
                continue
            if vertex_group.name in wheels:
                groups[vertex_group.index] = wheels[vertex_group.name]
                continue
            bone = armature.data.bones.get(vertex_group.name)
            while bone:
                if bone.name.casefold() in pivots:
                    groups[vertex_group.index] = pivots[bone.name.casefold()]
                    break
                bone = bone.parent

        data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph),
            preserve_all_data_layers=True, depsgraph=depsgraph)
        if len(data.vertices) != len(obj.data.vertices):
            raise RuntimeError(f"{asset_id}: cannot split evaluated bogies with a different vertex count")
        if asset_id in SMALL_GAUGE:
            for axle in ("f", "b"):
                group = next(g for g in obj.vertex_groups if g.name.casefold() == f"wheel_{axle}")
                shaft = [obj.matrix_world @ data.vertices[v.index].co for v in obj.data.vertices
                         if any(g.group == group.index and g.weight > 0.5 for g in v.groups)]
                if not shaft:
                    raise RuntimeError(f"{asset_id}: missing {axle} axle geometry")
                # The locomotive's wheel bones are offset vertically from the visible axle.
                pivots_by_name[f"rail-wheel-{axle}"] = Vector(tuple(
                    (min(p[i] for p in shaft) + max(p[i] for p in shaft)) / 2 for i in range(3)))
        weights = []
        for vertex in obj.data.vertices:
            totals = {}
            for group in vertex.groups:
                name = groups.get(group.group)
                totals[name] = totals.get(name, 0) + group.weight
            weights.append(totals)
        assignments = []
        for polygon in data.polygons:
            totals = {}
            for vertex_index in polygon.vertices:
                for name, weight in weights[vertex_index].items():
                    totals[name] = totals.get(name, 0) + weight
            assignments.append(max(totals, key=totals.get) if totals else None)

        if not any(assignments):
            bpy.data.meshes.remove(data)
            output.append(obj)
            continue
        for name in (None, *pivots_by_name):
            if name not in assignments:
                continue
            mesh = data.copy()
            editable = bmesh.new()
            try:
                editable.from_mesh(mesh)
                bmesh.ops.delete(editable, geom=[face for face in editable.faces if assignments[face.index] != name], context="FACES")
                bmesh.ops.delete(editable, geom=[vertex for vertex in editable.verts if not vertex.link_faces], context="VERTS")
                editable.to_mesh(mesh)
            finally:
                editable.free()
            if asset_id == "smalltrainengine" and name and name.startswith("rail-link-"):
                link = name.removeprefix("rail-link-").rsplit("-", 1)[0]
                extension = SMALL_ENGINE_SHAFT_EXTENSIONS.get(link)
                if extension is not None:
                    forward = [((obj.matrix_world @ vertex.co).x, vertex) for vertex in mesh.vertices]
                    tip = max(x for x, _ in forward)
                    local_extension = obj.matrix_world.to_3x3().inverted() @ Vector((extension, 0, 0))
                    for x, vertex in forward:
                        if tip - x < 0.001:
                            vertex.co += local_extension
                    mesh.update()
            part = bpy.data.objects.new(f"{name or 'rail-body'}-mesh", mesh)
            collection.objects.link(part)
            part.matrix_world = obj.matrix_world.copy()
            output.append(part)
            parts.append((name or "rail-body", part, pivots_by_name[name] if name else Vector((0, 0, ground))))
        bpy.data.meshes.remove(data)
        obj.hide_render = True
    present = {name for name, _, _ in parts}
    if not {name for name, bone in zip(NAMES, PIVOTS[asset_id]) if bone} <= present:
        raise RuntimeError(f"{asset_id}: expected rail pivot geometry is missing")
    if not set(part_parents) <= present:
        raise RuntimeError(f"{asset_id}: expected wheel or linkage pivot geometry is missing")
    return output, [(name, part, pivot, part_parents.get(name)) for name, part, pivot in parts]
