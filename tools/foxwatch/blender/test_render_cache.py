import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_cache import RenderCache, RENDER_SOURCE_FILES

class RenderCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for name in (*RENDER_SOURCE_FILES, "template.blend"):
            (self.root / name).write_text(name)
        (self.root / "mesh.gltf").write_text(json.dumps({"materials": [{"name": "material"}],
                                                        "buffers": [{"uri": "vertices.bin"}]}))
        (self.root / "vertices.bin").write_bytes(b"geometry")
        (self.root / "material.json").write_text(json.dumps({"Textures": {"Albedo": "albedo"}}))
        (self.root / "albedo.png").write_bytes(b"texture")
        self.output = str(self.root / "output.png")
        Path(self.output).write_bytes(b"rendered pixels")
        self.document = {"structure": {"id": "fixture", "name": "Before", "categoryId": "vehicles"},
                         "render": {"outputKey": "fixture"}, "scene": {"roots": []},
                         "assets": {"meshes": [{"exportUrl": "mesh.gltf"}]}}

    def tearDown(self):
        self.temporary.cleanup()

    def cache(self, settings=None):
        def resolve(name):
            path = self.root / name if name else None
            return str(path) if path and path.is_file() else None
        return RenderCache(str(self.root / "cache"), settings or {"previewSize": 512}, str(self.root),
                           str(self.root / "template.blend"), resolve,
                           lambda name: resolve(name + ".json"), lambda name: resolve(name + ".png"))

    def key(self, cache=None):
        return (cache or self.cache()).fingerprint([("fixture/scene.json", self.document)], [self.output])

    def test_reuse_verifies_outputs_and_does_not_rewrite_them(self):
        cache = self.cache()
        key = self.key(cache)
        cache.store("fixture", key, [self.output])
        before = os.stat(self.output).st_mtime_ns
        self.assertTrue(cache.lookup("fixture", key, [self.output]))
        self.assertEqual(before, os.stat(self.output).st_mtime_ns)
        Path(self.output).write_bytes(b"damaged output!")
        self.assertFalse(cache.lookup("fixture", key, [self.output]))
        Path(self.output).unlink()
        self.assertFalse(cache.lookup("fixture", key, [self.output]))

    def test_metadata_does_not_invalidate_but_pose_does(self):
        before = self.key()
        self.document["structure"].update(name="After", categoryId="items", description="New text", cost=17)
        self.assertEqual(before, self.key())
        self.document["scene"]["roots"] = [{"pose": {"rotation": [1, 2, 3]}}]
        self.assertNotEqual(before, self.key())

    def test_texture_and_external_geometry_bytes_invalidate_without_mtime_changes(self):
        for name in ("albedo.png", "vertices.bin"):
            before = self.key()
            path = self.root / name
            stat = path.stat()
            path.write_bytes(b"changed!"[:stat.st_size])
            os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
            self.assertNotEqual(before, self.key(), name)

    def test_material_and_variant_override_dependencies_invalidate(self):
        before = self.key()
        (self.root / "material.json").write_text(json.dumps({"Textures": {}, "Parameters": {"Roughness": 0.8}}))
        self.assertNotEqual(before, self.key())
        self.document["assets"]["meshes"][0]["materialSidecarNameOverridesByVariant"] = {"w": {"0": "override"}}
        before = self.key()
        (self.root / "override.json").write_text(json.dumps({"Textures": {"Albedo": "albedo"}}))
        self.assertNotEqual(before, self.key())

    def test_renderer_template_and_settings_invalidate(self):
        before = self.key()
        self.assertNotEqual(before, self.key(self.cache({"previewSize": 256})))
        (self.root / "render_scene_common.py").write_text("new rendering code")
        self.assertNotEqual(before, self.key())
        before = self.key()
        (self.root / "template.blend").write_text("new lights")
        self.assertNotEqual(before, self.key())

    def test_missing_or_corrupt_cache_and_incomplete_output_sets_miss(self):
        cache = self.cache()
        key = self.key(cache)
        self.assertFalse(cache.lookup("fixture", key, [self.output]))
        cache.store("fixture", key, [self.output])
        self.assertFalse(cache.lookup("fixture", key, [self.output, str(self.root / "sidecar.json")]))
        Path(cache.record_path("fixture")).write_text("broken json")
        self.assertFalse(cache.lookup("fixture", key, [self.output]))
        Path(cache.record_path("fixture")).write_text("[]")
        self.assertFalse(cache.lookup("fixture", key, [self.output]))

    def test_output_plan_matches_written_base_color_and_faction_sidecars(self):
        try:
            import bpy
        except ImportError:
            self.skipTest("Output planning integration requires Blender")
        from types import SimpleNamespace
        import render_render_scenes as renderer
        args = SimpleNamespace(output_dir=str(self.root / "types"), scene_variant=[],
                               render_data_root=str(self.root / "renders"))
        entry = {"structureId": "fixture", "outputPath": "fixture/scene.json"}
        for variants in ([], [{"id": "ffffff", "placeVariantAfterMode": True}],
                         [{"id": "c", "placeVariantAfterMode": True}, {"id": "w", "placeVariantAfterMode": True}]):
            document = {"structure": {"id": "fixture"}, "render": {"outputKey": "fixture"},
                        "scene": {"roots": []}, "variants": variants}
            planned, images = renderer.planned_cache_outputs(args, entry, document, ["topdown"])
            expected = {Path(file_path) for file_path in planned if file_path.endswith(".json")}
            for image in images:
                variant = image["sceneVariant"]
                state = {"resolution": (64, 32), "mode": "topdown", "sceneVariant": variant,
                         "previewVariant": None, "renderDataRoot": args.render_data_root}
                key = renderer.render_file_output_key(document, "topdown", None, variant)
                renderer.write_render_sidecar(image["path"], "fixture", key, state, 64, {})
            actual = {p for folder in (self.root / "types", self.root / "renders") for p in folder.rglob("*.json")}
            self.assertEqual(expected, actual)
            for file_path in actual:
                file_path.unlink()

result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(RenderCacheTests))
if not result.wasSuccessful():
    raise AssertionError("Render cache regression failed")
print("Render cache regressions passed")
