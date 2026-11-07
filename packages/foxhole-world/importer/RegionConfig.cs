public static class RegionConfig
{
    public static string Id => System.Environment.GetEnvironmentVariable("FOX_REGION") ?? "deadlands";
    public static string Map => System.Environment.GetEnvironmentVariable("FOX_MAP") ?? "DeadlandsHex";
    public static string MapPath => Map is "HomeRegionC" or "HomeRegionW"
        ? "War/Content/Maps/" + Map + ".umap"
        : "War/Content/Maps/Master/" + Map + ".umap";
}
