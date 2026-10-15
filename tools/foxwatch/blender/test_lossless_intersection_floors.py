import ast
import pathlib
import re
import unittest

source = pathlib.Path(__file__).with_name('render_render_scenes.py').read_text(encoding='utf8')
selector = next(node for node in ast.parse(source).body
                if isinstance(node, ast.FunctionDef) and node.name == 'is_bunker_floor_render')
namespace = {'re': re}
exec(compile(ast.Module(body=[selector], type_ignores=[]), '<lossless-floor-selector>', 'exec'), namespace)
is_floor = namespace['is_bunker_floor_render']

class LosslessIntersectionFloors(unittest.TestCase):
    def test_all_intersection_tier_floors_are_lossless(self):
        for tier in (1, 2, 3):
            self.assertTrue(is_floor(f'trenchintt{tier}', 'components/floor', 'topdown'))
            self.assertTrue(is_floor(f'trencht{tier}', 'components/floor', 'topdown'))

    def test_other_intersection_outputs_keep_existing_encoding(self):
        for output in ('components/backwall', 'trenchintt1', 'modifications/barbedwire'):
            self.assertFalse(is_floor('trenchintt1', output, 'topdown'))
        self.assertFalse(is_floor('trenchintt1', 'components/floor', 'preview'))
        self.assertFalse(is_floor('trenchintbuildsite', 'components/floor', 'topdown'))
        self.assertFalse(is_floor('trenchintdestroyedt1', 'components/floor', 'topdown'))

if __name__ == '__main__':
    unittest.main()
