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
    /// <summary>Render the AI turret's FiringConeAngle as a radial cone, preserving its mount frame.</summary>
    public static FoxWatchManifestFiringVolume? CreateCone(double[] origin, Quaternion orientation, double halfAngle, bool artillery = false)
    {
        if (origin.Length != 3 || origin.Any(value => !double.IsFinite(value))
            || !double.IsFinite(halfAngle) || halfAngle <= 0 || halfAngle > 180 || orientation.LengthSquared() < 0.001f) return null;
        orientation = Quaternion.Normalize(orientation);
        var quaternion = new double[] { orientation.X, orientation.Y, orientation.Z, orientation.W };
        if (quaternion.Any(value => !double.IsFinite(value))) return null;
        return new FoxWatchManifestFiringVolume {
            Source = artillery ? "ai-artillery" : "ai-turret", ConeHalfAngle = halfAngle,
            Origin = origin.Select(value => Math.Round(value, 5)).ToArray(),
            Orientation = quaternion.Select(value => Math.Round(value, 6)).ToArray(),
        };
    }

    // Legacy seat/ground overlays have corrective frames that the 3D Blueprint
    // model does not use. Move their reference without moving a resolved muzzle.
    public static void RotateLegacyRangeFrame(FoxWatchManifestFiringVolume? volume, double yaw, double x, double y)
    {
        if (volume?.OriginSource is not ("muzzle-component" or "muzzle-socket" or "gun-bone")) {
            Rotate(volume,yaw,x,y); return;
        }
        // Correct only the legacy planar reference; every physical muzzle and pose stays model-local.
        if (volume.Reference is { } reference) {
            var angle=yaw*Math.PI/180; var rx=reference.Origin[0]; var ry=reference.Origin[1];
            reference.Origin=[rx*Math.Cos(angle)-ry*Math.Sin(angle)+x,rx*Math.Sin(angle)+ry*Math.Cos(angle)+y];
            reference.Heading+=yaw;
        }
    }

    public static void Rotate(FoxWatchManifestFiringVolume? volume, double yawDegrees, double offsetX, double offsetY)
    {
        if (volume == null) return;
        var angle = yawDegrees * Math.PI / 180;
        var x = volume.Origin[0]; var y = volume.Origin[1];
        volume.Origin[0] = x * Math.Cos(angle) - y * Math.Sin(angle) + offsetX;
        volume.Origin[1] = x * Math.Sin(angle) + y * Math.Cos(angle) + offsetY;
        if (volume.Reference is { } reference) {
            var rx = reference.Origin[0]; var ry = reference.Origin[1];
            reference.Origin = [rx * Math.Cos(angle) - ry * Math.Sin(angle) + offsetX,
                rx * Math.Sin(angle) + ry * Math.Cos(angle) + offsetY];
            reference.Heading += yawDegrees;
        }
        void RotatePoint(double[] point) {
            var px=point[0]; var py=point[1];
            point[0]=px*Math.Cos(angle)-py*Math.Sin(angle)+offsetX;
            point[1]=px*Math.Sin(angle)+py*Math.Cos(angle)+offsetY;
        }
        foreach (var point in volume.MuzzleOrigins ?? []) RotatePoint(point);
        if (volume.PayloadPose is { } pose) RotatePoint(pose.MaximumOrigin);
        var q = volume.Orientation;
        var rotated = Quaternion.Normalize(Quaternion.CreateFromAxisAngle(Vector3.UnitZ, (float)angle)
            * new Quaternion((float)q[0], (float)q[1], (float)q[2], (float)q[3]));
        volume.Orientation = [rotated.X, rotated.Y, rotated.Z, rotated.W];
    }

}
