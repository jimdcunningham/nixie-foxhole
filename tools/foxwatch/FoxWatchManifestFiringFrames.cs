using System.Numerics;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.Animation;
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
                var frame = ResolveDeclaredFiringSocket(objects, blueprint, defaultObject, references, socket);
                if (frame != null) return frame;
            }
            var payload = ResolvePayloadFiringFrame(objects, blueprint, defaultObject, references, lookup, ExtractInt(index));
            if (payload != null) return payload;
            if (vehicle && GetObjectTypeName(component).Contains("VehicleSeatComponent", StringComparison.OrdinalIgnoreCase)
                && !AsEnumerable(info).Any() && !HasCompetingWeaponMount(objects, blueprint, component))
            {
                var unique = ResolveSingleLegacyMuzzle(references);
                if (unique != null) return unique;
            }
            // An explicitly mapped but unresolved muzzle must not use an unrelated socket.
            if (GetFiringSocketNames(info, ExtractInt(index)).Length > 0) return null;
        }
        if (vehicle)
        {
            // The legacy mech predates MuzzleInfo. Its Blueprint names each gun's
            // muzzle component and its main/left/right seats are indices 1/2/3.
            var property = string.Equals(GetObjectName(blueprint), "BPMech_C", StringComparison.OrdinalIgnoreCase)
                ? ExtractInt(index) switch { 1 => "MainGunMuzzleLocation", 2 => "LeftGunMuzzleLocation", 3 => "RightGunMuzzleLocation", _ => null }
                : null;
            var muzzleReference = property == null ? null : GetInheritedBlueprintProperty(objects, blueprint, defaultObject, property);
            if (muzzleReference != null)
            {
                // The scene components are positioned by game initialization;
                // their serialized zero transforms are not muzzle positions.
                var socket = ExtractInt(index) switch { 1 => "S_MainGunMuzzle", 2 => "S_LeftGunMuzzle", 3 => "S_RightGunMuzzle", _ => null };
                if (socket != null) return ResolveFiringSocketReferences(references, socket);
            }
            return null;
        }

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

    private bool HasCompetingWeaponMount(IEnumerable<dynamic> objects, object blueprint, object current)
    {
        var name = NormalizeTemplateComponentName(GetObjectName(current));
        var blueprintName = GetObjectName(blueprint);
        var candidates = objects.Cast<object>().Where(item => IsObjectOwnedByBlueprintScope(item, blueprintName, "Default__" + blueprintName))
            .Concat(EnumerateBlueprintComponentScopes(objects, blueprint).SelectMany(scope => scope.Objects.Where(item => IsObjectOwnedByBlueprintScope(item, scope.BlueprintName, scope.DefaultObjectName))));
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { name };
        foreach (var candidate in candidates)
        {
            var type = GetObjectTypeName(candidate);
            if (!type.Contains("VehicleSeatComponent", StringComparison.OrdinalIgnoreCase) && !type.Contains("StructureSeatComponent", StringComparison.OrdinalIgnoreCase)) continue;
            var candidateName = NormalizeTemplateComponentName(GetObjectName(candidate));
            if (seen.Contains(candidateName)) continue;
            if (ExtractBoolValue(GetInheritedBlueprintComponentProperty(objects, blueprint, candidate, "bIsEnabled")) == false) { seen.Add(candidateName); continue; }
            var code = ExtractText(GetInheritedBlueprintComponentProperty(objects, blueprint, candidate, "MountCodeName"));
            if (string.IsNullOrWhiteSpace(code)) continue; // A parent template may still provide it.
            seen.Add(candidateName);
            var direction = NormalizeSeatDirection(GetInheritedBlueprintComponentProperty(objects, blueprint, candidate, "Direction"));
            var data = ResolveMountDynamicDataEntry(code, direction);
            if (data == null || data.HasWeaponRange) return true; // An unknown mount cannot be assumed harmless.
        }
        return false;
    }

    private FiringFrame? ResolveSingleLegacyMuzzle(IReadOnlyList<FoxWatchBlueprintComponentReference> references)
    {
        var names = references.Where(reference => reference.MeshType == "skeletal" && !string.IsNullOrWhiteSpace(reference.MeshPath))
            .SelectMany(reference => GetSkeletalMeshAttachPointTransforms(reference.MeshPath).Keys)
            .Where(name => name.Contains("muzzle", StringComparison.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        // No muzzle table, one armed mount and one canonical physical muzzle form
        // a unique association. Multiple guns, unknown mounts or extra muzzles do not.
        return names.Length == 1 && string.Equals(names[0], "S_Muzzle", StringComparison.OrdinalIgnoreCase)
            ? ResolveFiringSocketReferences(references, names[0]) : null;
    }

    private FiringFrame? ResolvePayloadFiringFrame(IEnumerable<dynamic> objects, object blueprint, object defaultObject,
        IReadOnlyList<FoxWatchBlueprintComponentReference> references, IReadOnlyDictionary<string, object> lookup, int gunnerIndex)
    {
        var binding = GetInheritedBlueprintProperty(objects, blueprint, defaultObject, "PayloadMeshes");
        if (ExtractBoolValue(GetNamedValue(binding, "bUseForMuzzleTransform")) != true
            || ExtractInt(GetNamedValue(binding, "GunnerIndex")) != gunnerIndex) return null;
        var payloads = references.Where(reference => reference.ComponentType == "PayloadInstancedStaticMeshComponent").ToArray();
        if (payloads.Length != 1) return null; // Several grids need a separate source association/order.
        var payload = payloads[0];
        var components = objects.Cast<object>().Concat(EnumerateBlueprintComponentScopes(objects, blueprint).SelectMany(scope => scope.Objects)).Concat(lookup.Values)
            .Where(value => GetObjectTypeName(value).Contains("PayloadInstancedStaticMeshComponent", StringComparison.OrdinalIgnoreCase)
                && string.Equals(NormalizeTemplateComponentName(GetObjectName(value)), payload.ComponentName, StringComparison.OrdinalIgnoreCase)).ToArray();
        // The component's property declaration can precede its _GEN_VARIABLE
        // template in export order; read authored component templates, not that declaration.
        var rows = ExtractInt(components.Select(value => GetNamedValue(value, "Rows")).FirstOrDefault(value => value != null));
        var columns = ExtractInt(components.Select(value => GetNamedValue(value, "Columns")).FirstOrDefault(value => value != null));
        if (rows <= 0 || columns <= 0 || (long)rows * columns > 1024) return null;
        // The Blueprint explicitly selects this payload grid for muzzle transforms.
        // Use its authored launcher anchor; per-round grid offsets are not simulated.
        // MeshRotation describes the rocket artwork, not the firing frame.
        return new(ResolveFiringReferenceTransform(payload, references).Transform, "muzzle-component", payload.ComponentName);
    }

    private FiringFrame? ResolveDeclaredFiringSocket(IEnumerable<dynamic> objects, object blueprint, object defaultObject,
        IReadOnlyList<FoxWatchBlueprintComponentReference> references, string socket)
    {
        var actorMesh = GetInheritedBlueprintProperty(objects, blueprint, defaultObject, "Mesh");
        var keys = actorMesh == null ? [] : GetComponentLookupKeys(actorMesh).ToArray();
        var primary = references.FirstOrDefault(reference => keys.Contains(reference.ComponentName, StringComparer.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(reference.AnimationClassPath) && reference.MeshType == "skeletal");
        if (primary != null)
        {
            var candidates = references.Where(reference => reference.MeshType == "skeletal" && !string.IsNullOrWhiteSpace(reference.MeshPath)
                && GetSkeletalMeshAttachPointTransforms(reference.MeshPath).ContainsKey(socket)).ToArray();
            // Modular aircraft slots are visual parts of the explicitly bound,
            // animated actor mesh, not independent sources of its MuzzleInfo.
            if (candidates.Contains(primary) && candidates.All(reference => reference == primary
                || (reference.ComponentType == "AircraftPartSlotComponent" && string.IsNullOrWhiteSpace(reference.AnimationClassPath))))
                return ResolveFiringSocketReferences(references.Where(reference => reference == primary || !candidates.Contains(reference)).ToArray(), socket);
        }
        return ResolveFiringSocketReferences(references, socket);
    }

    private FiringFrame? ResolveFiringSocket(object blueprint, string socket)
    {
        return ResolveFiringSocketReferences(GetBlueprintComponentReferences(GetPackagePath(blueprint)), socket);
    }

    private FiringFrame? ResolveFiringSocketReferences(IReadOnlyList<FoxWatchBlueprintComponentReference> references, string socket)
    {
        var matches = new List<(FiringFrame Frame, string MeshPath)>();
        foreach (var mesh in references.Where(reference => !string.IsNullOrWhiteSpace(reference.MeshPath)
                     && reference.MeshType?.Contains("skeletal", StringComparison.OrdinalIgnoreCase) == true))
        {
            if (!GetSkeletalMeshAttachPointTransforms(mesh.MeshPath!).TryGetValue(socket, out var local)) continue;
            var transform = ComposeFiringTransform(ResolveFiringReferenceTransform(mesh, references), new(local, Vector3.One)).Transform;
            // This already includes the authored model hierarchy. Legacy planar
            // body-axis inference must not rotate this physical frame again.
            matches.Add((new(transform, "muzzle-socket", socket), mesh.MeshPath!));
        }
        if (matches.Count == 0) return null;
        // Shared skeletons also expose a gun socket on tracks, wings and other
        // parts. Prefer the mesh whose render sections use the socket's bone,
        // then its closest weighted ancestor. Equal ownership stays ambiguous.
        if (matches.Count > 1)
        {
            var ranked = matches.Select(match => (match, Rank: GetFiringSocketBoneRank(match.MeshPath, socket))).ToArray();
            var best = ranked.Min(item => item.Rank);
            if (best < int.MaxValue) matches = ranked.Where(item => item.Rank == best).Select(item => item.match).ToList();
        }
        var first = matches[0].Frame.Transform;
        // Modular parts may share a skeleton and the same socket frame. Accept
        // equivalent frames, but reject sockets placed on genuinely different guns.
        return matches.All(match => Math.Abs(match.Frame.Transform.X - first.X) < 0.1 && Math.Abs(match.Frame.Transform.Y - first.Y) < 0.1
            && Math.Abs(match.Frame.Transform.Z - first.Z) < 0.1 && Math.Abs(Quaternion.Dot(match.Frame.Transform.Rotation, first.Rotation)) > 0.999999f)
            ? matches[0].Frame : null;
    }

    private readonly Dictionary<string, Dictionary<string, int>> _firingSocketBoneRanks = new(StringComparer.OrdinalIgnoreCase);

    private int GetFiringSocketBoneRank(string meshPath, string socket)
    {
        if (_firingSocketBoneRanks.TryGetValue(meshPath, out var cached) && cached.TryGetValue(socket, out var rank)) return rank;
        if (cached == null) _firingSocketBoneRanks[meshPath] = cached = new(StringComparer.OrdinalIgnoreCase);
        rank = int.MaxValue;
        try
        {
            var mesh = _fileProvider.LoadPackage(meshPath).GetExports().OfType<USkeletalMesh>().FirstOrDefault();
            if (mesh == null) return cached[socket] = rank;
            var bones = mesh.ReferenceSkeleton.FinalRefBoneInfo;
            var weighted = mesh.LODModels?.FirstOrDefault()?.Sections.SelectMany(section => section.BoneMap).ToHashSet() ?? [];
            var skeleton = ResolveObjectReference<USkeleton>(GetNamedValue(mesh, "Skeleton"));
            var definitions = AsEnumerable(GetNamedValue(mesh, "Sockets")).Concat(AsEnumerable(GetNamedValue(skeleton, "Sockets")))
                .Select(value => ResolveObjectReference<UObject>(value)).Where(value => value != null).Cast<object>().ToList();
            var skeletonPath = ResolvePackagePath(ResolveReferencedPackagePath(GetNamedValue(mesh, "Skeleton")));
            if (!string.IsNullOrWhiteSpace(skeletonPath)) definitions.AddRange(_fileProvider.LoadPackage(skeletonPath).GetExports().Where(IsSkeletalMeshSocketExport));
            definitions.AddRange(_fileProvider.LoadPackage(meshPath).GetExports().Where(IsSkeletalMeshSocketExport));
            var definition = definitions.LastOrDefault(value => string.Equals(ExtractText(GetNamedValue(value, "SocketName")), socket, StringComparison.OrdinalIgnoreCase));
            var boneName = definition == null ? socket : ExtractText(GetNamedValue(definition, "BoneName"));
            var index = Array.FindIndex(bones, bone => string.Equals(bone.Name.Text, boneName, StringComparison.OrdinalIgnoreCase));
            var distance = 0;
            var visited = new HashSet<int>();
            while (index >= 0 && index < bones.Length && visited.Add(index))
            {
                if (weighted.Contains((ushort)index)) { rank = distance; break; }
                index = bones[index].ParentIndex;
                distance++;
            }
        }
        catch { /* Without mesh ownership evidence, keep normal ambiguity checks. */ }
        return cached[socket] = rank;
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
                AnimationClassPath = reference.AnimationClassPath,
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
