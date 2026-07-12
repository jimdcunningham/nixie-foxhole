using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FoxWatchService;

internal static class FoxWatchModificationRenderIdentity
{
    public static string ComputeRenderId(
        string variantId,
        string? dataClassPath,
        FoxWatchManifestModificationSlotVariant? variant)
    {
        return ComputeRenderIdWithDiagnostics(variantId, dataClassPath, variant).RenderId;
    }

    public static ModificationRenderIdentityComputation ComputeRenderIdWithDiagnostics(
        string variantId,
        string? dataClassPath,
        FoxWatchManifestModificationSlotVariant? variant)
    {
        var normalizedVariantId = NormalizeKeyComponent(variantId);
        var templatePath = ResolveTemplatePath(variant);
        // Identity is visual only. dataClassPath is a slot-catalog key (Front/Back/pipe host
        // catalogs) and must not participate. Host-specific pixel differences are handled by
        // scene-fingerprint routing after render scenes are built.
        var identity = string.Join("|", [
            NormalizeIdentityPart(variantId),
            NormalizeIdentityPart(templatePath),
        ]);
        var fullHashHex = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
        var truncatedHashHex = fullHashHex[..12];
        return new ModificationRenderIdentityComputation
        {
            VariantId = variantId,
            DataClassPath = dataClassPath ?? string.Empty,
            TemplatePath = templatePath,
            Identity = identity,
            FullHashHex = fullHashHex,
            TruncatedHashHex = truncatedHashHex,
            NormalizedVariantId = normalizedVariantId,
            RenderId = string.IsNullOrWhiteSpace(normalizedVariantId)
                ? truncatedHashHex
                : $"{normalizedVariantId}-{truncatedHashHex}",
        };
    }

    public static void AssignRenderIds(FoxWatchManifest manifest)
    {
        var renderIdsByConsumer = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var structure in manifest.Assets)
        {
            if (structure.ModificationSlots is not { Count: > 0 } modificationSlots)
            {
                continue;
            }

            foreach (var slot in modificationSlots)
            {
                if (slot.Variants is not { Count: > 0 } variants)
                {
                    continue;
                }

                foreach (var entry in variants)
                {
                    var variantId = entry.Key?.Trim();
                    if (string.IsNullOrWhiteSpace(variantId) || entry.Value == null)
                    {
                        continue;
                    }

                    var computation = ComputeRenderIdWithDiagnostics(variantId, slot.DataClassPath, entry.Value);
                    entry.Value.RenderId = computation.RenderId;
                    entry.Value.SharedModificationId = computation.RenderId;

                    var consumerKey = $"{structure.Id}|{slot.Name}|{slot.DataClassPath}|{variantId}";
                    if (renderIdsByConsumer.TryGetValue(consumerKey, out var existingRenderId)
                        && !string.Equals(existingRenderId, computation.RenderId, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException(
                            $"Conflicting renderId for consumer '{consumerKey}': '{existingRenderId}' vs '{computation.RenderId}'.");
                    }

                    renderIdsByConsumer[consumerKey] = computation.RenderId;
                }
            }
        }
    }

    public static FoxWatchModificationRenderIndex BuildRenderIndex(FoxWatchManifest manifest)
    {
        var entries = new Dictionary<string, FoxWatchModificationRenderIndexEntry>(StringComparer.OrdinalIgnoreCase);

        foreach (var structure in manifest.Assets)
        {
            if (structure.ModificationSlots is not { Count: > 0 } modificationSlots)
            {
                continue;
            }

            foreach (var slot in modificationSlots)
            {
                if (slot.Variants is not { Count: > 0 } variants)
                {
                    continue;
                }

                foreach (var entry in variants)
                {
                    var variantId = entry.Key?.Trim();
                    if (string.IsNullOrWhiteSpace(variantId) || entry.Value == null)
                    {
                        continue;
                    }

                    var variant = entry.Value;
                    var renderId = variant.RenderId?.Trim();
                    if (string.IsNullOrWhiteSpace(renderId))
                    {
                        var computation = ComputeRenderIdWithDiagnostics(variantId, slot.DataClassPath, variant);
                        renderId = computation.RenderId;
                        variant.RenderId = renderId;
                        variant.SharedModificationId = renderId;
                    }

                    if (!entries.TryGetValue(renderId, out var indexEntry))
                    {
                        var computation = ComputeRenderIdWithDiagnostics(variantId, slot.DataClassPath, variant);
                        indexEntry = new FoxWatchModificationRenderIndexEntry
                        {
                            RenderId = renderId,
                            VariantId = variantId,
                            Identity = computation.Identity,
                            DataClassPath = slot.DataClassPath,
                            TemplatePath = computation.TemplatePath,
                        };
                        entries[renderId] = indexEntry;
                    }

                    indexEntry.Consumers.Add(new FoxWatchModificationRenderIndexConsumer
                    {
                        StructureId = structure.Id,
                        SlotName = slot.Name,
                        DataClassPath = slot.DataClassPath,
                        VariantId = variantId,
                    });
                }
            }
        }

        var index = new FoxWatchModificationRenderIndex
        {
            Entries = entries,
        };
        AssignStorageFlags(index);
        return index;
    }

    public static FoxWatchModificationRenderIndex MergeRenderIndex(
        FoxWatchModificationRenderIndex existingIndex,
        FoxWatchModificationRenderIndex scopedIndex,
        IReadOnlySet<string> scopedStructureIds)
    {
        var mergedEntries = new Dictionary<string, FoxWatchModificationRenderIndexEntry>(StringComparer.OrdinalIgnoreCase);

        foreach (var entry in existingIndex.Entries.Values)
        {
            var renderId = entry.RenderId?.Trim();
            if (string.IsNullOrWhiteSpace(renderId))
            {
                continue;
            }

            var retainedConsumers = entry.Consumers
                .Where(consumer => !scopedStructureIds.Contains(consumer.StructureId))
                .ToList();
            if (retainedConsumers.Count == 0 && !scopedIndex.Entries.ContainsKey(renderId))
            {
                continue;
            }

            mergedEntries[renderId] = new FoxWatchModificationRenderIndexEntry
            {
                RenderId = renderId,
                VariantId = entry.VariantId,
                Identity = entry.Identity,
                DataClassPath = entry.DataClassPath,
                TemplatePath = entry.TemplatePath,
                Consumers = retainedConsumers,
            };
        }

        foreach (var entry in scopedIndex.Entries.Values)
        {
            var renderId = entry.RenderId?.Trim();
            if (string.IsNullOrWhiteSpace(renderId))
            {
                continue;
            }

            if (!mergedEntries.TryGetValue(renderId, out var mergedEntry))
            {
                mergedEntry = new FoxWatchModificationRenderIndexEntry
                {
                    RenderId = renderId,
                    Consumers = [],
                };
                mergedEntries[renderId] = mergedEntry;
            }

            mergedEntry.VariantId = entry.VariantId;
            mergedEntry.Identity = entry.Identity;
            mergedEntry.DataClassPath = entry.DataClassPath;
            mergedEntry.TemplatePath = entry.TemplatePath;

            foreach (var consumer in entry.Consumers)
            {
                if (mergedEntry.Consumers.Any(existing => ModificationRenderConsumersMatch(existing, consumer)))
                {
                    continue;
                }

                mergedEntry.Consumers.Add(consumer);
            }
        }

        var mergedIndex = new FoxWatchModificationRenderIndex
        {
            Entries = mergedEntries,
        };
        AssignStorageFlags(mergedIndex);
        return mergedIndex;
    }

    public static void AssignStorageFlags(FoxWatchModificationRenderIndex index)
    {
        foreach (var entry in index.Entries.Values)
        {
            var structureIds = entry.Consumers
                .Select(consumer => consumer.StructureId?.Trim())
                .Where(structureId => !string.IsNullOrWhiteSpace(structureId))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count();
            entry.Storage = structureIds > 1 || FoxWatchPublishedSharedModificationCatalog.IsSharedModificationRenderId(entry.RenderId)
                ? "shared"
                : null;
        }
    }

    public static bool IsSharedModificationRenderIndexEntry(FoxWatchModificationRenderIndexEntry? entry)
    {
        if (entry == null)
        {
            return false;
        }

        if (string.Equals(entry.Storage, "shared", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var structureIds = entry.Consumers
            .Select(consumer => consumer.StructureId?.Trim())
            .Where(structureId => !string.IsNullOrWhiteSpace(structureId))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        return structureIds > 1;
    }

    public static FoxWatchModificationRenderIndexEntry? TryGetModificationRenderIndexEntry(
        FoxWatchModificationRenderIndex? index,
        string renderId)
    {
        if (index?.Entries == null || string.IsNullOrWhiteSpace(renderId))
        {
            return null;
        }

        var normalizedRenderId = NormalizeKeyComponent(renderId);
        if (index.Entries.TryGetValue(normalizedRenderId, out var directMatch))
        {
            return directMatch;
        }

        foreach (var entry in index.Entries.Values)
        {
            if (string.Equals(NormalizeKeyComponent(entry.RenderId), normalizedRenderId, StringComparison.OrdinalIgnoreCase))
            {
                return entry;
            }
        }

        return null;
    }

    private static bool ModificationRenderConsumersMatch(
        FoxWatchModificationRenderIndexConsumer left,
        FoxWatchModificationRenderIndexConsumer right)
    {
        return string.Equals(left.StructureId, right.StructureId, StringComparison.OrdinalIgnoreCase)
            && string.Equals(left.SlotName, right.SlotName, StringComparison.OrdinalIgnoreCase)
            && string.Equals(left.DataClassPath, right.DataClassPath, StringComparison.OrdinalIgnoreCase)
            && string.Equals(left.VariantId, right.VariantId, StringComparison.OrdinalIgnoreCase);
    }

    public static string ResolveTemplatePath(FoxWatchManifestModificationSlotVariant? variant)
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

internal sealed class ModificationRenderIdentityComputation
{
    public string VariantId { get; set; } = string.Empty;

    public string DataClassPath { get; set; } = string.Empty;

    public string TemplatePath { get; set; } = string.Empty;

    public string Identity { get; set; } = string.Empty;

    public string FullHashHex { get; set; } = string.Empty;

    public string TruncatedHashHex { get; set; } = string.Empty;

    public string NormalizedVariantId { get; set; } = string.Empty;

    public string RenderId { get; set; } = string.Empty;
}

public sealed class FoxWatchModificationRenderIndex
{
    public Dictionary<string, FoxWatchModificationRenderIndexEntry> Entries { get; set; } = [];
}

public sealed class FoxWatchModificationRenderIndexEntry
{
    public string RenderId { get; set; } = string.Empty;

    public string VariantId { get; set; } = string.Empty;

    public string Identity { get; set; } = string.Empty;

    public string? DataClassPath { get; set; }

    public string TemplatePath { get; set; } = string.Empty;

    public string? Storage { get; set; }

    public List<FoxWatchModificationRenderIndexConsumer> Consumers { get; set; } = [];
}

public sealed class FoxWatchModificationRenderIndexConsumer
{
    public string StructureId { get; set; } = string.Empty;

    public string SlotName { get; set; } = string.Empty;

    public string? DataClassPath { get; set; }

    public string VariantId { get; set; } = string.Empty;
}

internal static class FoxWatchModificationRenderIndexWriter
{
    public static async Task<FoxWatchModificationRenderIndex?> LoadAsync(
        string outputPath,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(outputPath))
        {
            return null;
        }

        var serializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
        };

        await using var stream = File.OpenRead(outputPath);
        return await JsonSerializer.DeserializeAsync<FoxWatchModificationRenderIndex>(stream, serializerOptions, cancellationToken);
    }

    public static async Task WriteAsync(
        FoxWatchModificationRenderIndex index,
        string outputPath,
        CancellationToken cancellationToken = default)
    {
        var outputDirectory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(outputDirectory))
        {
            Directory.CreateDirectory(outputDirectory);
        }

        var serializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = true,
        };

        var json = JsonSerializer.Serialize(index, serializerOptions);
        await File.WriteAllTextAsync(outputPath, $"{json}{Environment.NewLine}", cancellationToken);
    }
}
