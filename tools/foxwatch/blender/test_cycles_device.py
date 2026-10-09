import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

source = Path(__file__).with_name('render_readability.py')
function = next(node for node in ast.parse(source.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == 'configure_cycles_device')
code = compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec')

class DeviceTests(unittest.TestCase):
    def harness(self, requested='AUTO', gpu=True):
        devices = [SimpleNamespace(type='CPU', name='CPU', use=True)]
        if gpu:
            devices.append(SimpleNamespace(type='CUDA', name='Test GPU', use=False))
        preferences = SimpleNamespace(devices=devices, compute_device_type='NONE', refresh_devices=lambda: None)
        namespace = {'_cycles_device': None, 'os': SimpleNamespace(environ={'FOXWATCH_CYCLES_DEVICE': requested}),
            'bpy': SimpleNamespace(context=SimpleNamespace(preferences=SimpleNamespace(addons={'cycles': SimpleNamespace(preferences=preferences)})))}
        exec(code, namespace)
        scene = SimpleNamespace(cycles=SimpleNamespace(device='CPU'))
        return namespace, preferences, scene

    def test_gpu_selected_without_cpu_and_reapplied_for_each_scene(self):
        namespace, preferences, scene = self.harness()
        namespace['configure_cycles_device'](scene)
        self.assertEqual(scene.cycles.device, 'GPU')
        self.assertFalse(preferences.devices[0].use)
        self.assertTrue(preferences.devices[1].use)
        scene.cycles.device = 'CPU'
        namespace['configure_cycles_device'](scene)
        self.assertEqual(scene.cycles.device, 'GPU')

    def test_no_gpu_falls_back_to_cpu(self):
        namespace, _, scene = self.harness(gpu=False)
        namespace['configure_cycles_device'](scene)
        self.assertEqual(scene.cycles.device, 'CPU')

    def test_explicit_cpu_does_not_probe_backends(self):
        namespace, preferences, scene = self.harness('CPU')
        namespace['configure_cycles_device'](scene)
        self.assertEqual(scene.cycles.device, 'CPU')
        self.assertEqual(preferences.compute_device_type, 'NONE')

    def test_unknown_backend_is_an_error(self):
        namespace, _, scene = self.harness('TYPO')
        with self.assertRaises(ValueError):
            namespace['configure_cycles_device'](scene)

result = unittest.main(argv=['test_cycles_device'], exit=False).result
if not result.wasSuccessful():
    raise RuntimeError('Cycles device tests failed')