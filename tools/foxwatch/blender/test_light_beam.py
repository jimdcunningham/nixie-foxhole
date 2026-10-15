import unittest
from render_light_beam import light_beam_uv_opacity


class LightBeamOpacityTests(unittest.TestCase):
    def test_edges_and_outside_are_transparent(self):
        for u, v in [(0, .5), (1, .5), (.5, 0), (.5, 1), (-.2, .5), (.5, 1.2)]:
            self.assertEqual(light_beam_uv_opacity(u, v), 0)

    def test_native_mask_peak_is_not_the_scalar_parameter(self):
        self.assertAlmostEqual(light_beam_uv_opacity(.5, .5), .152587890625)
        self.assertEqual(light_beam_uv_opacity(.5, .5, 0), 0)
        self.assertAlmostEqual(light_beam_uv_opacity(.5, .5, 2), .30517578125)

    def test_fade_is_symmetric_and_bounded(self):
        for i in range(21):
            for j in range(21):
                u, v = i/20, j/20
                value = light_beam_uv_opacity(u, v)
                self.assertAlmostEqual(value, light_beam_uv_opacity(1-u, 1-v))
                self.assertGreaterEqual(value, 0)
                self.assertLessEqual(value, .152587890625)


if __name__ == '__main__':
    unittest.main()
