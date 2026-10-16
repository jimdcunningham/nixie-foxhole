namespace FoxWatchService;

using System.Numerics;

/// <summary>Local payload positions from the native row-major launcher layout.</summary>
public static class FoxWatchPayloadGrid
{
    public static Vector3[]? CreateOffsets(int rows, int columns, double rowSpacing, double columnSpacing)
    {
        // The native fields are bytes. Keep malformed grids bounded before allocation.
        if (rows is < 1 or > 255 || columns is < 1 or > 255 || (long)rows * columns > 1024
            || !double.IsFinite(rowSpacing) || !double.IsFinite(columnSpacing)
            || Math.Abs(rowSpacing) > 10000 || Math.Abs(columnSpacing) > 10000) return null;
        return Enumerable.Range(0, rows * columns).Select(index => new Vector3(0,
            (float)(-(index % columns) * columnSpacing),
            (float)(-(index / columns) * rowSpacing))).ToArray();
    }
}
