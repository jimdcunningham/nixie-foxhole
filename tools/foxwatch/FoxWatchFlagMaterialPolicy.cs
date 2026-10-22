namespace FoxWatchService;

using System.Text.RegularExpressions;

internal static class FoxWatchFlagMaterialPolicy
{
    internal static bool IsAuthoredPlane(string componentName, string meshPath) =>
        Regex.IsMatch(componentName, @"\AFlag[0-9]*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
        && meshPath.EndsWith("/Meshes/Measurement/Plane.uasset", StringComparison.OrdinalIgnoreCase);
}
