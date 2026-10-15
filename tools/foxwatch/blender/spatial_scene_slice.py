"""Select spatial meshes while preserving their authored transform ancestry."""
from copy import deepcopy


def slice_spatial_scene(document, mode):
    result = deepcopy(document)

    def visit(node, inside_upgrade=False):
        if node.get('visible') is False:
            return None
        inside_upgrade = inside_upgrade or ':upgrade:' in node.get('id', '')
        if mode == 'base' and inside_upgrade:
            return None
        if mode == 'upgrade' and not inside_upgrade:
            node.pop('meshId', None)
            node.pop('primitive', None)
            node.pop('light', None)
        node['children'] = [child for entry in node.get('children', [])
                            if (child := visit(entry, inside_upgrade)) is not None]
        return node

    result['scene']['roots'] = [root for entry in result['scene']['roots']
                                if (root := visit(entry)) is not None]
    return result
