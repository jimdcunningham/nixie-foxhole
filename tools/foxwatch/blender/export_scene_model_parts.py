"""Retain source-backed placements while replacing shared source subtrees."""
import bpy
from mathutils import Matrix


def extract_shared_model_parts(meshes, collection, center):
    shared = {}
    for obj in meshes:
        ancestor = obj.parent
        while ancestor is not None:
            marker = ancestor.get("foxwatchSharedPart")
            if marker:
                shared.setdefault(ancestor, []).append(obj)
                break
            ancestor = ancestor.parent
    replacements = {}
    parts = []
    for source, members in shared.items():
        if any(obj.modifiers for obj in members):
            raise RuntimeError("Shared model trial does not support evaluated mesh modifiers")
        marker = dict(source["foxwatchSharedPart"])
        placeholder = bpy.data.objects.new(marker["nodeName"], None)
        collection.objects.link(placeholder)
        placeholder.matrix_world = Matrix.Translation(-center) @ source.matrix_world
        placeholder.select_set(True)
        for obj in members:
            replacements[obj] = placeholder
        parts.append({"nodeName": placeholder.name, "resourceId": marker["resourceId"]})
    return replacements, parts
