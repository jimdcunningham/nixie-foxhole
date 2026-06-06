namespace FoxWatchService;

using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

public sealed class FoxWatchAssetMeshExportProbe
{
    private readonly ILogger<FoxWatchAssetMeshExportProbe> _logger;

    public FoxWatchAssetMeshExportProbe(ILogger<FoxWatchAssetMeshExportProbe> logger)
    {
        _logger = logger;
    }

    public async Task WriteReportAsync(string outputPath, string? pakDirectoryPath, CancellationToken cancellationToken = default)
    {
        var report = CreateReport(pakDirectoryPath);
        var serializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = true,
        };

        var outputDirectory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(outputDirectory))
        {
            Directory.CreateDirectory(outputDirectory);
        }

        var json = JsonSerializer.Serialize(report, serializerOptions);
        await File.WriteAllTextAsync(outputPath, $"{json}{Environment.NewLine}", cancellationToken);
        _logger.LogInformation("Wrote FoxWatch mesh export probe to {OutputPath}", outputPath);
    }

    private FoxWatchAssetMeshExportProbeReport CreateReport(string? pakDirectoryPath)
    {
        var cue4ParseAssembly = TryLoadAssembly("CUE4Parse");
        var conversionAssembly = TryLoadAssembly("CUE4Parse-Conversion");

        return new FoxWatchAssetMeshExportProbeReport
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            PakDirectoryPath = pakDirectoryPath,
            PakDirectoryExists = !string.IsNullOrWhiteSpace(pakDirectoryPath) && Directory.Exists(pakDirectoryPath),
            Assemblies = [
                DescribeAssembly(cue4ParseAssembly, "CUE4Parse"),
                DescribeAssembly(conversionAssembly, "CUE4Parse-Conversion"),
            ],
            MeshRelatedTypes = DescribeInterestingTypes(cue4ParseAssembly, conversionAssembly),
            ExporterHints = DescribeExporterHints(conversionAssembly),
        };
    }

    private static Assembly? TryLoadAssembly(string assemblyName)
    {
        try
        {
            return Assembly.Load(assemblyName);
        }
        catch
        {
            return null;
        }
    }

    private static FoxWatchAssetMeshProbeAssembly DescribeAssembly(Assembly? assembly, string expectedName)
    {
        if (assembly == null)
        {
            return new FoxWatchAssetMeshProbeAssembly
            {
                ExpectedName = expectedName,
                Loaded = false,
            };
        }

        var name = assembly.GetName();
        return new FoxWatchAssetMeshProbeAssembly
        {
            ExpectedName = expectedName,
            Loaded = true,
            Name = name.Name,
            Version = name.Version?.ToString(),
            Location = SafeGetLocation(assembly),
        };
    }

    private static string? SafeGetLocation(Assembly assembly)
    {
        try
        {
            return string.IsNullOrWhiteSpace(assembly.Location) ? null : assembly.Location;
        }
        catch
        {
            return null;
        }
    }

    private static List<FoxWatchAssetMeshProbeType> DescribeInterestingTypes(Assembly? cue4ParseAssembly, Assembly? conversionAssembly)
    {
        var reports = new List<FoxWatchAssetMeshProbeType>();
        foreach (var assembly in new[] { cue4ParseAssembly, conversionAssembly }.Where(entry => entry != null))
        {
            foreach (var type in SafeGetTypes(assembly!))
            {
                if (!IsInterestingType(type))
                {
                    continue;
                }

                reports.Add(new FoxWatchAssetMeshProbeType
                {
                    Assembly = type.Assembly.GetName().Name,
                    FullName = type.FullName ?? type.Name,
                    Kind = DescribeTypeKind(type),
                    PublicConstructors = type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                        .Select(DescribeConstructor)
                        .OrderBy(signature => signature, StringComparer.Ordinal)
                        .ToList(),
                    PublicMethods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                        .Select(DescribeMethod)
                        .OrderBy(signature => signature, StringComparer.Ordinal)
                        .ToList(),
                    PublicProperties = type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                        .Select(DescribeProperty)
                        .OrderBy(signature => signature, StringComparer.Ordinal)
                        .ToList(),
                    PublicFields = type.GetFields(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                        .Select(DescribeField)
                        .OrderBy(signature => signature, StringComparer.Ordinal)
                        .ToList(),
                });
            }
        }

        return reports
            .OrderBy(entry => entry.Assembly, StringComparer.Ordinal)
            .ThenBy(entry => entry.FullName, StringComparer.Ordinal)
            .ToList();
    }

    private static List<string> DescribeExporterHints(Assembly? conversionAssembly)
    {
        if (conversionAssembly == null)
        {
            return [];
        }

        return SafeGetTypes(conversionAssembly)
            .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                .Select(method => new { Type = type, Method = method }))
            .Where(entry => entry.Method.Name.Contains("Export", StringComparison.OrdinalIgnoreCase)
                || entry.Method.Name.Contains("Write", StringComparison.OrdinalIgnoreCase)
                || entry.Method.Name.Contains("Save", StringComparison.OrdinalIgnoreCase)
                || (entry.Type.FullName?.Contains("Gltf", StringComparison.OrdinalIgnoreCase) ?? false)
                || (entry.Type.FullName?.Contains("Mesh", StringComparison.OrdinalIgnoreCase) ?? false))
            .Select(entry => $"{entry.Type.FullName}.{DescribeMethod(entry.Method)}")
            .Distinct(StringComparer.Ordinal)
            .OrderBy(entry => entry, StringComparer.Ordinal)
            .ToList();
    }

    private static IEnumerable<Type> SafeGetTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException exception)
        {
            return exception.Types.Where(type => type != null)!;
        }
    }

    private static bool IsInterestingType(Type type)
    {
        var fullName = type.FullName ?? type.Name;
        return fullName.Contains("Mesh", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("Skeleton", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("Skeletal", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("StaticMesh", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("Material", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("Gltf", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("Exporter", StringComparison.OrdinalIgnoreCase);
    }

    private static string DescribeTypeKind(Type type)
    {
        if (type.IsInterface)
        {
            return "interface";
        }

        if (type.IsEnum)
        {
            return "enum";
        }

        if (type.IsValueType)
        {
            return "struct";
        }

        return type.IsAbstract ? "abstract-class" : "class";
    }

    private static string DescribeMethod(MethodInfo method)
    {
        var parameters = string.Join(", ", method.GetParameters().Select(parameter => $"{SimplifyTypeName(parameter.ParameterType)} {parameter.Name}"));
        return $"{SimplifyTypeName(method.ReturnType)} {method.Name}({parameters})";
    }

    private static string DescribeConstructor(ConstructorInfo constructor)
    {
        var parameters = string.Join(", ", constructor.GetParameters().Select(parameter => $"{SimplifyTypeName(parameter.ParameterType)} {parameter.Name}"));
        return $"{constructor.DeclaringType?.Name ?? constructor.Name}({parameters})";
    }

    private static string DescribeProperty(PropertyInfo property)
    {
        return $"{SimplifyTypeName(property.PropertyType)} {property.Name}";
    }

    private static string DescribeField(FieldInfo field)
    {
        return $"{SimplifyTypeName(field.FieldType)} {field.Name}";
    }

    private static string SimplifyTypeName(Type type)
    {
        if (!type.IsGenericType)
        {
            return type.Name;
        }

        var genericName = type.Name[..type.Name.IndexOf('`')];
        var genericArguments = string.Join(", ", type.GetGenericArguments().Select(SimplifyTypeName));
        return $"{genericName}<{genericArguments}>";
    }
}

public sealed class FoxWatchAssetMeshExportProbeReport
{
    public string SchemaVersion { get; set; } = "1.0.0";

    public DateTimeOffset GeneratedAt { get; set; }

    public string? PakDirectoryPath { get; set; }

    public bool PakDirectoryExists { get; set; }

    public List<FoxWatchAssetMeshProbeAssembly> Assemblies { get; set; } = [];

    public List<FoxWatchAssetMeshProbeType> MeshRelatedTypes { get; set; } = [];

    public List<string> ExporterHints { get; set; } = [];
}

public sealed class FoxWatchAssetMeshProbeAssembly
{
    public string ExpectedName { get; set; } = string.Empty;

    public bool Loaded { get; set; }

    public string? Name { get; set; }

    public string? Version { get; set; }

    public string? Location { get; set; }
}

public sealed class FoxWatchAssetMeshProbeType
{
    public string? Assembly { get; set; }

    public string FullName { get; set; } = string.Empty;

    public string Kind { get; set; } = string.Empty;

    public List<string> PublicConstructors { get; set; } = [];

    public List<string> PublicMethods { get; set; } = [];

    public List<string> PublicProperties { get; set; } = [];

    public List<string> PublicFields { get; set; } = [];
}