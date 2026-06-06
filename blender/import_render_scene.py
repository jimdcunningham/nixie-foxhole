import argparse
import os
import sys

import bpy

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from script_bootstrap import append_script_search_paths


append_script_search_paths(globals().get("__file__"), bpy.data.filepath, os.getcwd())

from render_scene_common import (  # noqa: E402
    apply_render_mode,
    collection_world_bounds,
    create_bounds_debug_box,
    load_json,
    normalize_search_roots,
    remove_default_startup_scene_objects,
    resolve_scene_variant_id,
    remove_collections_with_prefix,
)
from render_scene_graph import import_render_scene  # noqa: E402


def parse_args():
    raw_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", help="Absolute path to a single render bundle scene manifest")
    parser.add_argument("--index", help="Absolute path to render bundle index manifest")
    parser.add_argument("--structure-id", help="Structure id to resolve from the index manifest")
    parser.add_argument("--public-root", default=None)
    parser.add_argument("--foxwatch-output-root", default=None)
    parser.add_argument("--replace-existing", action="store_true")
    parser.add_argument("--mode", choices=["topdown", "preview", "icon"], default="preview")
    parser.add_argument("--scene-variant", default=None)
    parser.add_argument("--preview-size", type=int, default=512)
    parser.add_argument("--icon-size", type=int, default=256)
    parser.add_argument("--debug-bounds", action="store_true")
    parser.add_argument("--purge-existing", action="store_true")
    return parser.parse_args(raw_args)


def resolve_scene_path(args):
    if args.scene:
        return args.scene

    if not args.index or not args.structure_id:
        raise ValueError("Provide --scene or both --index and --structure-id")

    index_document = load_json(args.index)
    for scene_entry in index_document.get("scenes", []):
        if scene_entry.get("structureId") == args.structure_id:
            return os.path.join(os.path.dirname(args.index), scene_entry["outputPath"])

    raise ValueError(f"Could not find structure '{args.structure_id}' in render bundle index")


def main():
    args = parse_args()
    remove_default_startup_scene_objects()
    scene_path = resolve_scene_path(args)
    scene_document = load_json(scene_path)
    resolved_scene_variant = resolve_scene_variant_id(scene_document, args.scene_variant)
    search_roots = normalize_search_roots(args.public_root, args.foxwatch_output_root)
    if args.purge_existing:
        remove_collections_with_prefix("FoxWatch:")

    collection = import_render_scene(
        scene_document,
        search_roots,
        replace_existing=args.replace_existing,
        scene_variant=resolved_scene_variant,
    )
    bounds = collection_world_bounds(collection)
    if args.debug_bounds:
        create_bounds_debug_box(collection, bounds[0], bounds[1])
    render_state = apply_render_mode(
        scene_document,
        collection,
        args.mode,
        scene_variant=resolved_scene_variant,
        preview_size=args.preview_size,
        icon_size=args.icon_size,
        bounds=bounds,
    )
    scene_variant_suffix = f" [{render_state['sceneVariant']}]" if render_state["sceneVariant"] else ""
    print(f"Imported render bundle scene: {scene_path} ({render_state['mode']}{scene_variant_suffix} via {render_state['camera']})")


if __name__ == "__main__":
    main()
