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
}
