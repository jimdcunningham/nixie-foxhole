using System.Numerics;
using CUE4Parse.UE4.Assets.Exports;
using Newtonsoft.Json.Linq;

namespace FoxWatchService;

public partial class FoxWatchManifestAssetExtractor
{
    private readonly record struct FiringFrame(ManifestComponentTransform Transform, string Source, string Name);

    // Use the explicit gunner mapping, never a nearby seat or the first socket on a multi-gun mesh.
    private static string[] GetFiringSocketNames(object? muzzleInfo, int gunnerIndex) => AsEnumerable(muzzleInfo)
        .Where(info => ExtractInt(GetNamedValue(info, "GunnerIndex")) == gunnerIndex)
        .OrderBy(info => ExtractInt(GetNamedValue(info, "MuzzleIndex")))
        .Select(info => NormalizeComponentReferenceName(ExtractText(GetNamedValue(info, "SocketName"))))
        .Where(name => !string.IsNullOrWhiteSpace(name) && !string.Equals(name, "None", StringComparison.OrdinalIgnoreCase))
        .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

    private FiringFrame? ResolveWeaponFiringFrame(IEnumerable<dynamic> objects, object blueprint, object defaultObject,
        object component, IReadOnlyDictionary<string, object> lookup, bool vehicle)
    {
        var references = GetFiringComponentReferences(objects, blueprint, lookup);
        var index = GetInheritedBlueprintComponentProperty(objects, blueprint, component, vehicle ? "Index" : "GunnerIndex");
        if (index != null || vehicle)
        {
            var info = GetInheritedBlueprintProperty(objects, blueprint, defaultObject, "MuzzleInfo");
            foreach (var socket in GetFiringSocketNames(info, ExtractInt(index)))
            {
                var frame = ResolveFiringSocketReferences(references, socket);
                if (frame != null) return frame;
            }
            // An explicitly mapped but unresolved muzzle must not use an unrelated socket.
            if (GetFiringSocketNames(info, ExtractInt(index)).Length > 0) return null;
        }
        if (vehicle) return null;

        // Native fort AI exposes its muzzle FX arrow separately from the AI controller.
        var reference = GetInheritedBlueprintComponentProperty(objects, blueprint, component, "MuzzleFlashLocationComponent");
        if (reference == null && lookup.Values.Distinct().Count(item => IsAiTurretComponentType(GetObjectTypeName(item))) == 1)
            reference = GetInheritedBlueprintProperty(objects, blueprint, defaultObject, "MuzzleFlashLocationComponent");
        if (reference != null)
        {
            foreach (var key in GetComponentLookupKeys(reference))
                if (lookup.TryGetValue(key, out var muzzle))
                {
                    var referenceFrame = references.FirstOrDefault(item => string.Equals(NormalizeComponentReferenceName(item.ComponentName), key, StringComparison.OrdinalIgnoreCase));
                    var transform = referenceFrame == null ? ResolveBlueprintComponentTransform(objects, blueprint, muzzle, lookup)
                        : ApplyKnownBlueprintReferenceFrameCorrections(referenceFrame, references, ResolveFiringReferenceTransform(referenceFrame, references).Transform);
                    return new(transform, "muzzle-component", key);
                }
        }
        return null;
    }

    private FiringFrame? ResolveFiringSocket(object blueprint, string socket)
    {
        return ResolveFiringSocketReferences(GetBlueprintComponentReferences(GetPackagePath(blueprint)), socket);
    }

    private FiringFrame? ResolveFiringSocketReferences(IReadOnlyList<FoxWatchBlueprintComponentReference> references, string socket)
    {
        var matches = new List<FiringFrame>();
        foreach (var mesh in references.Where(reference => !string.IsNullOrWhiteSpace(reference.MeshPath)
                     && reference.MeshType?.Contains("skeletal", StringComparison.OrdinalIgnoreCase) == true))
        {
            if (!GetSkeletalMeshAttachPointTransforms(mesh.MeshPath!).TryGetValue(socket, out var local)) continue;
            var transform = ComposeFiringTransform(ResolveFiringReferenceTransform(mesh, references), new(local, Vector3.One)).Transform;
            transform = ApplyKnownBlueprintReferenceFrameCorrections(mesh, references, transform);
            matches.Add(new(transform, "muzzle-socket", socket));
        }
        if (matches.Count == 0) return null;
        var first = matches[0].Transform;
        // Modular parts may share a skeleton and the same socket frame. Accept
        // equivalent frames, but reject sockets placed on genuinely different guns.
        return matches.All(match => Math.Abs(match.Transform.X - first.X) < 0.1 && Math.Abs(match.Transform.Y - first.Y) < 0.1
            && Math.Abs(match.Transform.Z - first.Z) < 0.1 && Math.Abs(Quaternion.Dot(match.Transform.Rotation, first.Rotation)) > 0.999999f)
            ? matches[0] : null;
    }

    private FiringFrame? ResolveArtilleryGunFrame(IEnumerable<dynamic> objects, object blueprint, IReadOnlyDictionary<string, object> lookup, ManifestComponentTransform aimingFrame)
    {
        var references = GetFiringComponentReferences(objects, blueprint, lookup);
        var meshes = references.Where(reference => string.Equals(reference.ComponentName, "Mesh", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(reference.MeshPath)).ToArray();
        if (meshes.Length != 1) return null;
        var mesh = meshes[0];
        var points = GetSkeletalMeshAttachPointTransforms(mesh.MeshPath!);
        // These are source bone names, not inferred points on the model bounds. Their
        // local axes differ between tiers; coverage keeps the structure's aiming frame.
        foreach (var name in new[] { "GunBarrel", "verticalPivot" })
        {
            if (!points.TryGetValue(name, out var bone)) continue;
            var world = ComposeFiringTransform(ResolveFiringReferenceTransform(mesh, references), new(bone, Vector3.One)).Transform;
            return new(world with { Rotation = aimingFrame.Rotation }, "gun-bone", name);
        }
        return null;
    }

    private IReadOnlyList<FoxWatchBlueprintComponentReference> GetFiringComponentReferences(IEnumerable<dynamic> objects,
        object blueprint, IReadOnlyDictionary<string, object> lookup)
    {
        var unresolvedNativeFrame = false;
        var result = GetBlueprintComponentReferences(GetPackagePath(blueprint)).Select(reference =>
        {
            var component = lookup.Values.FirstOrDefault(value => string.Equals(NormalizeTemplateComponentName(GetObjectName(value)),
                NormalizeTemplateComponentName(reference.ComponentName), StringComparison.OrdinalIgnoreCase));
            var rotation = component == null ? null : ReadAuthoredFiringRotation(component);
            if (rotation == null && component != null)
            {
                var name = NormalizeTemplateComponentName(GetObjectName(component));
                rotation = EnumerateBlueprintComponentScopes(objects, blueprint).SelectMany(scope => scope.Objects)
                    .Where(value => string.Equals(NormalizeTemplateComponentName(GetObjectName(value)), name, StringComparison.OrdinalIgnoreCase))
                    .Select(ReadAuthoredFiringRotation).FirstOrDefault(value => value != null);
            }
            // Live native accessors can materialize zero for an omitted child value.
            // Read the actual Blueprint hierarchy, preserving an explicit zero.
            if (rotation == null)
            {
                // A native Character mesh's omitted constructor rotation is not
                // recoverable from CUE4Parse's zero-valued runtime accessor. The
                // decoded inspection used by model generation carries that frame.
                if (component is UObject && string.Equals(reference.ComponentName, "CharacterMesh0", StringComparison.OrdinalIgnoreCase)
                    && Math.Abs(ParseRotatorValue(reference.RelativeRotation, "yaw") ?? 0) < 0.001)
                    unresolvedNativeFrame = true;
                return reference;
            }
            return new FoxWatchBlueprintComponentReference
            {
                ComponentName = reference.ComponentName,
                ComponentType = reference.ComponentType,
                SourceClassName = reference.SourceClassName,
                MeshType = reference.MeshType,
                MeshPath = reference.MeshPath,
                MeshName = reference.MeshName,
                AttachParentName = reference.AttachParentName,
                AttachSocketName = reference.AttachSocketName,
                RelativeLocation = reference.RelativeLocation,
                RelativeScale = reference.RelativeScale,
                AbsoluteLocation = reference.AbsoluteLocation,
                AbsoluteRotation = reference.AbsoluteRotation,
                AbsoluteScale = reference.AbsoluteScale,
                RelativeRotation = FormattableString.Invariant($"P={ExtractVectorComponent(rotation, "Pitch") ?? 0} Y={ExtractVectorComponent(rotation, "Yaw") ?? 0} R={ExtractVectorComponent(rotation, "Roll") ?? 0}")
            };
        }).ToArray();
        return unresolvedNativeFrame ? [] : result;
    }

    private static object? ReadAuthoredFiringRotation(object component)
    {
        if (component is UObject native)
        {
            var visited = new HashSet<UObject>();
            while (visited.Add(native) && visited.Count <= 128)
            {
                var property = native.Properties.FirstOrDefault(value => value.Name.Text == "RelativeRotation");
                if (property != null) return UnwrapScriptValue(property.Tag?.GetValue(typeof(object)));
                UObject? template = null;
                try { template = native.Template?.Object?.Value; } catch { }
                if (template == null) break;
                native = template;
            }
            return null;
        }
        if (component is JObject json)
            return UnwrapScriptValue(json["Properties"]?["RelativeRotation"] ?? json["RelativeRotation"]);
        return null;
    }

    private readonly record struct FiringTransform(ManifestComponentTransform Transform, Vector3 Scale);

    private static FiringTransform ComposeFiringTransform(FiringTransform parent, FiringTransform local)
    {
        var p = parent.Transform; var l = local.Transform;
        var offset = Vector3.Transform(new Vector3((float)l.X, (float)l.Y, (float)l.Z) * parent.Scale, p.Rotation);
        return new(new(p.X + offset.X, p.Y + offset.Y, p.Z + offset.Z, Quaternion.Normalize(p.Rotation * l.Rotation)), parent.Scale * local.Scale);
    }

    private FiringTransform ResolveFiringReferenceTransform(FoxWatchBlueprintComponentReference reference,
        IReadOnlyList<FoxWatchBlueprintComponentReference> references, HashSet<string>? ancestry = null)
    {
        ancestry ??= new(StringComparer.OrdinalIgnoreCase);
        var local = ExtractRelativeComponentReferenceTransform(reference);
        var scale = new Vector3((float)(ParseVectorValue(reference.RelativeScale, "x") ?? 1),
            (float)(ParseVectorValue(reference.RelativeScale, "y") ?? 1), (float)(ParseVectorValue(reference.RelativeScale, "z") ?? 1));
        var frame = new FiringTransform(local, scale);
        var name = NormalizeComponentReferenceName(reference.ComponentName);
        var parent = references.FirstOrDefault(item => string.Equals(NormalizeComponentReferenceName(item.ComponentName),
            NormalizeComponentReferenceName(reference.AttachParentName), StringComparison.OrdinalIgnoreCase));
        if (parent == null)
        {
            var absolute = ExtractAbsoluteComponentReferenceTransform(reference);
            return absolute != null && !ShouldPreferRelativeComponentReferenceTransform(reference, local, absolute.Value)
                ? new(absolute.Value, new((float)(ParseVectorValue(reference.AbsoluteScale, "x") ?? scale.X),
                    (float)(ParseVectorValue(reference.AbsoluteScale, "y") ?? scale.Y), (float)(ParseVectorValue(reference.AbsoluteScale, "z") ?? scale.Z))) : frame;
        }
        if (!ancestry.Add(name)) return frame;
        try
        {
            var parentFrame = ResolveFiringReferenceTransform(parent, references, ancestry);
            if (TryResolveAttachSocketTransform(parent, reference.AttachSocketName, out var attachment))
                parentFrame = ComposeFiringTransform(parentFrame, new(attachment, Vector3.One));
            return ComposeFiringTransform(parentFrame, frame);
        }
        finally { ancestry.Remove(name); }
    }

    private static FoxWatchManifestFiringVolume? SetFiringFrame(FoxWatchManifestFiringVolume? volume,
        FiringFrame? muzzle, ManifestComponentTransform rangeFrame, double heading)
    {
        if (volume == null) return null;
        volume.Reference = new() { Origin = [rangeFrame.X / 100, rangeFrame.Y / 100], Heading = heading };
        volume.OriginSource = muzzle?.Source ?? "firing-component";
        volume.OriginName = muzzle?.Name;
        return volume;
    }
}
