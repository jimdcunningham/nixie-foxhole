namespace FoxWatchService;

// Packaged meshes are exported standalone, without their intact blueprint body frame.
internal static class FoxWatchPackagedBodyFrameResolver
{
    private const double Epsilon = 0.000001;

    internal static bool TryResolveBlenderYawDegrees(
        IReadOnlyList<FoxWatchRenderSceneNode> roots,
        out double yawDegrees)
    {
        var candidates = new List<(int Priority, double? Yaw)>();
        foreach (var root in roots) Collect(root, 0, candidates);
        yawDegrees = 0;
        if (candidates.Count == 0) return false;
        var priority = candidates.Min(candidate => candidate.Priority);
        var bodyFrames = candidates.Where(candidate => candidate.Priority == priority).ToList();
        if (bodyFrames.Any(candidate => candidate.Yaw == null)) return false;
        var first = Normalize(bodyFrames[0].Yaw!.Value);
        if (bodyFrames.Any(candidate => Math.Abs(Normalize(candidate.Yaw!.Value - first)) > Epsilon)) return false;
        yawDegrees = first;
        return true;
    }

    private static void Collect(
        FoxWatchRenderSceneNode node,
        double? parentYaw,
        List<(int Priority, double? Yaw)> candidates)
    {
        if (!node.Visible) return;
        var worldYaw = parentYaw != null && TryResolveLocalYaw(node, out var localYaw)
            ? parentYaw.Value + localYaw : (double?)null;
        var priority = node.Name.ToLowerInvariant() switch
        {
            "charactermesh0" => 0,
            "skeletalmesh" => 1,
            "mainmesh" => 2,
            "fuselagegroup" or "enginegroup" or "leftwinggroup" or "rightwinggroup" or "tailgroup" => 3,
            _ => -1,
        };
        if (priority >= 0 && ContainsVisibleMesh(node)) candidates.Add((priority, worldYaw));
        foreach (var child in node.Children) Collect(child, worldYaw, candidates);
    }

    private static bool ContainsVisibleMesh(FoxWatchRenderSceneNode node) =>
        node.Visible && (!string.IsNullOrWhiteSpace(node.MeshId) || node.Children.Any(ContainsVisibleMesh));

    private static bool TryResolveLocalYaw(FoxWatchRenderSceneNode node, out double yaw)
    {
        yaw = 0;
        if (node.Scale is { } scale && (scale.Count != 3 || scale.Any(value => !double.IsFinite(value) || value <= 0)
            || Math.Abs(scale[0] - scale[1]) > Epsilon)) return false;
        var rotation = node.RotationEulerDegrees ?? node.UnrealRotationDegrees;
        if (rotation != null)
        {
            if (rotation.Count != 3 || rotation.Any(value => !double.IsFinite(value))) return false;
            if (node.RotationEulerDegrees != null)
            {
                if (Math.Abs(Normalize(rotation[0])) > Epsilon || Math.Abs(Normalize(rotation[1])) > Epsilon) return false;
                yaw = rotation[2];
            }
            else
            {
                if (Math.Abs(Normalize(rotation[0])) > Epsilon || Math.Abs(Normalize(rotation[2])) > Epsilon) return false;
                // Unreal's reflected Y axis reverses yaw in Blender's coordinate frame.
                yaw = -rotation[1];
            }
            return true;
        }
        // Explicit location/scale uses an Euler identity rather than transformMatrix in Blender.
        if (node.Location != null || node.Scale != null) return true;
        var matrix = node.TransformMatrix;
        if (matrix.Count != 16 || matrix.Any(value => !double.IsFinite(value))) return false;
        if (Math.Abs(matrix[2]) > Epsilon || Math.Abs(matrix[6]) > Epsilon
            || Math.Abs(matrix[8]) > Epsilon || Math.Abs(matrix[9]) > Epsilon) return false;
        var xLength = Math.Sqrt(matrix[0] * matrix[0] + matrix[4] * matrix[4]);
        var yLength = Math.Sqrt(matrix[1] * matrix[1] + matrix[5] * matrix[5]);
        if (xLength <= Epsilon || yLength <= Epsilon || matrix[10] <= Epsilon
            || Math.Abs(xLength - yLength) > Epsilon
            || Math.Abs(matrix[0] * matrix[1] + matrix[4] * matrix[5]) > Epsilon
            || matrix[0] * matrix[5] - matrix[1] * matrix[4] <= 0) return false;
        yaw = Math.Atan2(matrix[4], matrix[0]) * 180 / Math.PI;
        return true;
    }

    private static double Normalize(double degrees)
    {
        var wrapped = degrees % 360;
        if (wrapped > 180) wrapped -= 360;
        if (wrapped <= -180) wrapped += 360;
        return wrapped;
    }
}
