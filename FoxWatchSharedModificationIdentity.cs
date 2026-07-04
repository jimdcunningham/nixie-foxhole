using System.Security.Cryptography;
using System.Text;

namespace FoxWatchService;

internal static class FoxWatchSharedModificationIdentity
{
    public static string ComputeManifestId(string variantId, FoxWatchManifestModificationSlotVariant? variant)
    {
        var normalizedVariantId = NormalizeKeyComponent(variantId);
        var identity = string.Join("|", [
            NormalizeIdentityPart(variantId),
            NormalizeIdentityPart(ResolveTemplatePath(variant)),
        ]);
        var truncatedHashHex = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant()[..12];
        return string.IsNullOrWhiteSpace(normalizedVariantId)
            ? truncatedHashHex
            : $"{normalizedVariantId}-{truncatedHashHex}";
    }

    private static string ResolveTemplatePath(FoxWatchManifestModificationSlotVariant? variant)
    {
        if (!string.IsNullOrWhiteSpace(variant?.TemplateActorPath))
        {
            return variant.TemplateActorPath;
        }

        if (!string.IsNullOrWhiteSpace(variant?.TemplateMeshPath))
        {
            return variant.TemplateMeshPath;
        }

        if (!string.IsNullOrWhiteSpace(variant?.PreviewMeshPath))
        {
            return variant.PreviewMeshPath;
        }

        return string.Empty;
    }

    private static string NormalizeIdentityPart(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
    }

    private static string NormalizeKeyComponent(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        var needsSeparator = false;
        foreach (var character in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                needsSeparator = false;
                continue;
            }

            if (!needsSeparator && builder.Length > 0)
            {
                builder.Append('-');
                needsSeparator = true;
            }
        }

        return builder.ToString().Trim('-');
    }
}
