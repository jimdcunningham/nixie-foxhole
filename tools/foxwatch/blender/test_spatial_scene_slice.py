import unittest
from copy import deepcopy
from spatial_scene_slice import slice_spatial_scene


class SpatialSceneSliceTests(unittest.TestCase):
    def test_slices_preserve_attachment_transform_ancestry_and_source(self):
        document = {'scene': {'roots': [{'id': 'base', 'meshId': 'building',
            'translation': [1, 2, 3], 'children': [{'id': 'socket',
                'rotation': [0, 0, 90], 'children': [{'id': 'root:upgrade:forge',
                    'meshId': 'forge', 'children': [{'id': 'pipe', 'meshId': 'pipe'}]}]},
                {'id': 'hidden', 'visible': False, 'meshId': 'destroyed'}]}]}}
        original = deepcopy(document)
        base = slice_spatial_scene(document, 'base')['scene']['roots'][0]
        self.assertEqual(base['meshId'], 'building')
        self.assertEqual(base['children'][0]['children'], [])
        upgrade = slice_spatial_scene(document, 'upgrade')['scene']['roots'][0]
        self.assertNotIn('meshId', upgrade)
        self.assertEqual(upgrade['translation'], [1, 2, 3])
        socket = upgrade['children'][0]
        self.assertEqual(socket['rotation'], [0, 0, 90])
        self.assertEqual(socket['children'][0]['children'][0]['meshId'], 'pipe')
        self.assertEqual(len(upgrade['children']), 1)
        self.assertEqual(document, original)

    def test_whole_scene_excludes_invisible_subtrees(self):
        document = {'scene': {'roots': [{'id': 'hidden', 'visible': False,
            'children': [{'id': 'visible-child', 'meshId': 'wreck'}]}]}}
        self.assertEqual(slice_spatial_scene(document, 'whole')['scene']['roots'], [])


if __name__ == '__main__':
    unittest.main()
