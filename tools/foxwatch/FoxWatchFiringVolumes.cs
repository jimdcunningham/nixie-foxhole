namespace FoxWatchService;

using System.Numerics;

/// <summary>Preserve explicit aiming limits; spread/jitter cones and missing pitch do not define an envelope.</summary>
public static class FoxWatchFiringVolumes
{
    public static FoxWatchManifestFiringVolume? Create(double[] origin, Quaternion orientation,
        double? minYaw, double? maxYaw, double? minPitch, double? maxPitch)
    {
        if (origin.Length != 3 || origin.Any(value => !double.IsFinite(value))
            || minYaw is not double yawMin || maxYaw is not double yawMax
            || minPitch is not double pitchMin || maxPitch is not double pitchMax
            || !double.IsFinite(yawMin) || !double.IsFinite(yawMax) || !double.IsFinite(pitchMin) || !double.IsFinite(pitchMax)
            || pitchMin < -90 || pitchMax > 90 || pitchMin >= pitchMax || orientation.LengthSquared() < 0.001f)
            return null;
        if (yawMax < yawMin) yawMax += 360;
        if (yawMax <= yawMin || yawMax - yawMin > 360 || yawMin < -360 || yawMax > 360) return null;
        orientation = Quaternion.Normalize(orientation);
        var quaternion = new double[] { orientation.X, orientation.Y, orientation.Z, orientation.W };
        if (quaternion.Any(value => !double.IsFinite(value))) return null;
        return new FoxWatchManifestFiringVolume {
            Origin = origin.Select(value => Math.Round(value, 5)).ToArray(),
            Orientation = quaternion.Select(value => Math.Round(value, 6)).ToArray(),
            MinYaw = yawMin, MaxYaw = yawMax, MinPitch = pitchMin, MaxPitch = pitchMax,
        };
    }
    public static void Rotate(FoxWatchManifestFiringVolume? volume, double yawDegrees, double offsetX, double offsetY)
    {
        if (volume == null) return;
        var angle = yawDegrees * Math.PI / 180;
        var x = volume.Origin[0]; var y = volume.Origin[1];
        volume.Origin[0] = x * Math.Cos(angle) - y * Math.Sin(angle) + offsetX;
        volume.Origin[1] = x * Math.Sin(angle) + y * Math.Cos(angle) + offsetY;
        var q = volume.Orientation;
        var rotated = Quaternion.Normalize(Quaternion.CreateFromAxisAngle(Vector3.UnitZ, (float)angle)
            * new Quaternion((float)q[0], (float)q[1], (float)q[2], (float)q[3]));
        volume.Orientation = [rotated.X, rotated.Y, rotated.Z, rotated.W];
    }

}
