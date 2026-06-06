import math

from mathutils import Euler, Matrix, Vector

from render_scene_common import matrix_from_manifest


UNREAL_TO_BLENDER_BASIS = Matrix((
    (1.0, 0.0, 0.0, 0.0),
    (0.0, -1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
))


def unreal_location_centimeters_to_blender(location):
    if location is None:
        return None

    return Vector([
        float(location[0]) * 0.01,
        -float(location[1]) * 0.01,
        float(location[2]) * 0.01,
    ])


def unreal_scene_location_centimeters_to_blender(location):
    if location is None:
        return None

    return Vector([
        float(location[0]) * 0.01,
        -float(location[1]) * 0.01,
        float(location[2]) * 0.01,
    ])


def unreal_rotator_degrees_to_blender_euler(rotation):
    if rotation is None:
        return None

    return unreal_rotator_degrees_to_blender_matrix(rotation).to_euler("XYZ")


def unreal_rotator_degrees_to_blender_matrix(rotation):
    if rotation is None:
        return None

    pitch = math.radians(float(rotation[0]))
    yaw = math.radians(float(rotation[1]))
    roll = math.radians(float(rotation[2]))

    unreal_rotation = (
        Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Rotation(pitch, 4, "Y")
        @ Matrix.Rotation(roll, 4, "X")
    )
    return UNREAL_TO_BLENDER_BASIS @ unreal_rotation @ UNREAL_TO_BLENDER_BASIS


def loc_rot_scale_matrix(location_vector, rotation_matrix, scale_vector):
    translation_matrix = Matrix.Translation(location_vector or Vector([0.0, 0.0, 0.0]))
    scale_diagonal = scale_vector or Vector([1.0, 1.0, 1.0])
    scale_matrix = Matrix.Diagonal((scale_diagonal[0], scale_diagonal[1], scale_diagonal[2], 1.0))
    return translation_matrix @ (rotation_matrix or Matrix.Identity(4)) @ scale_matrix


def node_transform(node_document):
    location = node_document.get("location")
    rotation = node_document.get("rotationEulerDegrees")
    scale = node_document.get("scale")

    if location is None and node_document.get("unrealSceneLocationCentimeters") is not None:
        location_vector = unreal_scene_location_centimeters_to_blender(node_document.get("unrealSceneLocationCentimeters"))
    elif location is None and node_document.get("unrealLocationCentimeters") is not None:
        location_vector = unreal_location_centimeters_to_blender(node_document.get("unrealLocationCentimeters"))
    else:
        location_vector = Vector(location or [0.0, 0.0, 0.0]) if (location is not None or rotation is not None or scale is not None) else None

    if rotation is None and node_document.get("unrealRotationDegrees") is not None:
        rotation_matrix = unreal_rotator_degrees_to_blender_matrix(node_document.get("unrealRotationDegrees"))
    else:
        rotation_euler = Euler([math.radians(value) for value in (rotation or [0.0, 0.0, 0.0])], "XYZ") if (location is not None or rotation is not None or scale is not None) else None
        rotation_matrix = rotation_euler.to_matrix().to_4x4() if rotation_euler is not None else None

    if location is not None or rotation is not None or scale is not None:
        scale_vector = Vector(scale or [1.0, 1.0, 1.0])
        return loc_rot_scale_matrix(location_vector, rotation_matrix, scale_vector)

    if location_vector is not None or rotation_matrix is not None or scale is not None:
        scale_vector = Vector(scale or [1.0, 1.0, 1.0])
        return loc_rot_scale_matrix(location_vector, rotation_matrix, scale_vector)

    return matrix_from_manifest(node_document.get("transformMatrix", []))