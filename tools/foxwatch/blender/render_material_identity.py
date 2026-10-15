"""Resolve authored material package identity without ambiguous basename guesses."""
import os
from pathlib import PurePosixPath


def resolve_material_sidecar_identity(reference, search_roots, filename_index):
    normalized = str(reference or '').replace('\\', '/')
    if '/' in normalized:
        path = PurePosixPath(normalized)
        if path.is_absolute() or ':' in normalized or any(part in ('.', '..') for part in normalized.split('/')):
            return None
        suffix = path.suffix.lower()
        if suffix in ('.uasset', '.json'):
            path = path.with_suffix('.json')
        elif suffix:
            return None
        else:
            path = PurePosixPath(str(path) + '.json')
        for root in search_roots:
            candidate = os.path.join(root, *path.parts)
            if os.path.isfile(candidate):
                return candidate
        # A missing qualified identity must never downgrade to another basename.
        return None
    target = normalized + '.json'
    candidates = []
    for root in search_roots:
        if not root or not os.path.isdir(root):
            continue
        for name, matches in filename_index(root).items():
            if name.casefold() == target.casefold():
                candidates.extend(matches)
    unique = {os.path.normcase(os.path.realpath(candidate)): candidate for candidate in candidates}
    return next(iter(unique.values())) if len(unique) == 1 else None
