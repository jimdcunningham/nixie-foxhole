namespace FoxWatchService;

[Obsolete("Use FoxWatchModificationRenderIdentity.ComputeRenderId (identity is variantId|templatePath).")]
internal static class FoxWatchSharedModificationIdentity
{
    public static string ComputeManifestId(string variantId, FoxWatchManifestModificationSlotVariant? variant)
    {
        return FoxWatchModificationRenderIdentity.ComputeRenderId(variantId, dataClassPath: null, variant);
    }

    public static string ComputeManifestId(
        string variantId,
        string? dataClassPath,
        FoxWatchManifestModificationSlotVariant? variant)
    {
        return FoxWatchModificationRenderIdentity.ComputeRenderId(variantId, dataClassPath, variant);
    }
}
