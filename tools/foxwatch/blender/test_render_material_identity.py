import os
from pathlib import Path
import tempfile
import unittest
from render_material_identity import resolve_material_sidecar_identity


def index(root):
    result = {}
    for current, _, names in os.walk(root):
        for name in names:
            result.setdefault(os.path.normcase(name), []).append(os.path.join(current, name))
    return result


class MaterialIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for relative in ['War/Content/Materials/Environment/IVy.json', 'War/Content/Materials/Environment/Props/Ivy.json', 'War/Content/Materials/Environment/Town/TownRoofShingles02.json']:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{}')

    def tearDown(self):
        self.temp.cleanup()

    def resolve(self, value):
        return resolve_material_sidecar_identity(value, [str(self.root)], index)

    def test_exact_native_path_wins_over_case_colliding_basename(self):
        self.assertEqual(Path(self.resolve('War/Content/Materials/Environment/Props/Ivy.uasset')), self.root / 'War/Content/Materials/Environment/Props/Ivy.json')

    def test_exact_other_namespace_preserved(self):
        self.assertEqual(Path(self.resolve('War/Content/Materials/Environment/IVy')), self.root / 'War/Content/Materials/Environment/IVy.json')

    def test_ambiguous_basename_is_refused(self):
        self.assertIsNone(self.resolve('Ivy'))
        self.assertIsNone(self.resolve('IVy'))

    def test_existing_unique_basename_remains_supported(self):
        self.assertEqual(Path(self.resolve('TownRoofShingles02')), self.root / 'War/Content/Materials/Environment/Town/TownRoofShingles02.json')

    def test_missing_qualified_path_does_not_fallback(self):
        self.assertIsNone(self.resolve('War/Content/Materials/Elsewhere/TownRoofShingles02.uasset'))

    def test_qualified_json_supported(self):
        self.assertEqual(Path(self.resolve('War/Content/Materials/Environment/Props/Ivy.json')), self.root / 'War/Content/Materials/Environment/Props/Ivy.json')

    def test_path_escape_is_refused(self):
        for reference in ['../Ivy', '/War/Content/Ivy', 'War/../Content/Ivy', 'C:/Ivy']:
            self.assertIsNone(self.resolve(reference))

    def test_duplicate_search_root_does_not_create_ambiguity(self):
        self.assertIsNotNone(resolve_material_sidecar_identity('TownRoofShingles02', [str(self.root), str(self.root)], index))


if __name__ == '__main__':
    unittest.main()
