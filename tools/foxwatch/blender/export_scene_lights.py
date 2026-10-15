"""Capture authored fixture placement before mesh baking flattens the hierarchy."""
import json
from mathutils import Vector


def collect_blueprint_lights(collection, center):
    lights = []
    for obj in collection.all_objects:
        source = obj.get("foxwatchBlueprintLight")
        if not source or obj.hide_render:
            continue
        data = json.loads(source)
        location = obj.matrix_world.translation - center
        direction = (obj.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()
        group = None
        ancestor = obj
        while ancestor is not None:
            group = ancestor.get("foxwatchSpatialGroup")
            if group:
                break
            ancestor = ancestor.parent
        lights.append({"name": obj.name, "source": data, "group": group,
                       "translation": [location.x, location.z, -location.y],
                       "direction": [direction.x, direction.z, -direction.y]})
    if len(lights) > 64:
        raise ValueError("Blueprint exceeds the 64-light model budget")
    return lights
