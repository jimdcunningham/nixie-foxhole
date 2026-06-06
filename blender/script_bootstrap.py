import os
import sys


def append_script_search_paths(file_path=None, blend_path=None, cwd=None) -> None:
    candidates = []

    if file_path:
        candidates.append(os.path.dirname(os.path.abspath(file_path)))

    if blend_path:
        candidates.append(os.path.dirname(os.path.abspath(blend_path)))

    if cwd:
        candidates.append(os.path.join(cwd, "tools", "foxwatch", "blender"))
        candidates.append(cwd)

    for candidate in candidates:
        if candidate and os.path.isdir(candidate) and candidate not in sys.path:
            sys.path.append(candidate)