"""Export rigid wheel groups around the authored bogie or axle pivots."""
import bmesh
import bpy
from mathutils import Vector

# Each family shares the same pivot names. Shaft/rod children of those
# pivots follow the wheels, while the chassis keeps its independently baked pose.
PIVOTS = {
    "trainengine": (None, "BogieBack"),
    "traincoal": ("Bogie_Front", "Bogie_Back"),
    "trainhospital": ("FAxis_PIVOT", "RAxis_PIVOT"),
    "trainlrartillery": ("FrontAxle_PIVOT", "BackAxle_PIVOT"),
    **dict.fromkeys(("traincaboose", "traincombatcarc", "traincombatcarw", "trainflatbed", "traininfantry"),
                    ("frontAxle_PIVOT", "backAxle_PIVOT")),
    **dict.fromkeys(("smalltrainengine", "smalltrainliquid", "smalltrainmaterial", "smalltrainresource", "smalltrainshipping"),
                    ("Wheel_F", "Wheel_B")),
}
NAMES = ("rail-bogie-front", "rail-bogie-rear")


def split_rail_bogies(asset_id, meshes, collection, ground):
    if asset_id not in PIVOTS:
        return meshes, []
    output, bogies = [], []
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
        groups = {}
        for vertex_group in obj.vertex_groups:
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
            part = bpy.data.objects.new(f"{name or 'rail-body'}-mesh", mesh)
            collection.objects.link(part)
            part.matrix_world = obj.matrix_world.copy()
            output.append(part)
            bogies.append((name or "rail-body", part, pivots_by_name[name] if name else Vector((0, 0, ground))))
        bpy.data.meshes.remove(data)
        obj.hide_render = True
    if {name for name, _, _ in bogies if name != "rail-body"} != {name for name, bone in zip(NAMES, PIVOTS[asset_id]) if bone}:
        raise RuntimeError(f"{asset_id}: expected rail pivot geometry is missing")
    return output, bogies
