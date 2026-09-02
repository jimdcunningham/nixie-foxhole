namespace FoxWatchService;

public sealed class FoxWatchTargetFilter
{
    public static FoxWatchTargetFilter Empty { get; } = new([], []);

    public FoxWatchTargetFilter(IEnumerable<string> structureIds, IEnumerable<string> categoryIds)
    {
        StructureIds = structureIds
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        CategoryIds = categoryIds
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlySet<string> StructureIds { get; }

    public IReadOnlySet<string> CategoryIds { get; }

    public bool HasFilters => StructureIds.Count > 0 || CategoryIds.Count > 0;

    public static FoxWatchTargetFilter FromArguments(FoxWatchCliArguments arguments)
    {
        return new FoxWatchTargetFilter(arguments.GetListValues("only"), arguments.GetListValues("category"));
    }

    public bool Matches(FoxWatchManifestStructure structure)
    {
        var matchesStructure = MatchesStructureOnly(structure);
        var matchesCategory = CategoryIds.Count == 0
            || CategoryIds.Contains(structure.CategoryId);
        return matchesStructure && matchesCategory;
    }

    public bool MatchesStructureOnly(FoxWatchManifestStructure structure)
    {
        return StructureIds.Count == 0
            || StructureIds.Contains(structure.Id)
            || StructureIds.Contains(structure.CodeName)
            || (!string.IsNullOrWhiteSpace(structure.ParentStructureId) && StructureIds.Contains(structure.ParentStructureId))
            || (!string.IsNullOrWhiteSpace(structure.RootStructureId) && StructureIds.Contains(structure.RootStructureId));
    }

    public override string ToString()
    {
        var onlyText = StructureIds.Count > 0 ? string.Join(", ", StructureIds.OrderBy(value => value, StringComparer.OrdinalIgnoreCase)) : "<any>";
        var categoryText = CategoryIds.Count > 0 ? string.Join(", ", CategoryIds.OrderBy(value => value, StringComparer.OrdinalIgnoreCase)) : "<any>";
        return $"only={onlyText}; category={categoryText}";
    }
}