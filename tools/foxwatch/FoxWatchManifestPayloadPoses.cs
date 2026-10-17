using System.Numerics;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;

namespace FoxWatchService;

public partial class FoxWatchManifestAssetExtractor
{
    // These are source graph bindings, not authored coordinates or guessed elevations.
    private (FiringTransform Frame, FoxWatchManifestPayloadPose Pose)? ResolvePayloadPose(object blueprint,
        FoxWatchBlueprintComponentReference payload, IReadOnlyList<FoxWatchBlueprintComponentReference> references,
        double minimumPitch, double maximumPitch, bool requiresDeployment)
    {
        var binding = FoxWatchPayloadPoseSampler.Bindings.SingleOrDefault(value => value.Blueprint == GetObjectName(blueprint));
        var meshReference = references.SingleOrDefault(value => value.ComponentName == payload.AttachParentName && value.MeshType == "skeletal");
        if (binding == null || meshReference == null || string.IsNullOrWhiteSpace(meshReference.MeshPath)) return null;
        var prefix = "War/Content/Animation/";
        var animationPath = prefix + binding.Animation + ".uasset";
        if (ResolvePackagePath(meshReference.AnimationClassPath) != ResolvePackagePath(animationPath)) return null;
        var animationObjects = LoadPackageExports(animationPath);
        var animationClass = FindBlueprintGeneratedClass(animationObjects);
        if (animationClass == null) return null;
        var defaults = ResolveBlueprintDefaultObject(animationObjects, animationClass);
        // Verify the actual cooked fast-path binding before reading the blend space.
        var handlers = AsEnumerable(GetNamedValue(animationClass, "EvaluateGraphExposedInputs"));
        var nodeNames = handlers.Where(handler => AsEnumerable(GetNamedValue(handler, "CopyRecords")).Any(copy =>
            ExtractText(GetNamedValue(copy, "SourcePropertyName")) == "GunnerPitch"
            && ExtractText(GetNamedValue(copy, "PostCopyOperation"))?.EndsWith("::None") == true))
            .Select(handler => NormalizeComponentReferenceName(ExtractText(GetNamedValue(handler, "ValueHandlerNodeProperty")))).ToArray();
        var nodes = nodeNames.Select(name => GetNamedValue(defaults, name)).Where(node => node != null).ToArray();
        var blendPath = prefix + binding.BlendSpace + ".uasset";
        if (!nodes.Any(node => ResolvePackagePath(ResolveReferencedPackagePath(GetNamedValue(node, "BlendSpace"))) == ResolvePackagePath(blendPath))) return null;
        var blendObjects = LoadPackageExports(blendPath);
        object? blend = blendObjects.Cast<object>().FirstOrDefault(value => GetObjectTypeName(value).Contains("BlendSpace1D", StringComparison.OrdinalIgnoreCase));
        if (blend == null) return null;
        var samples = AsEnumerable(GetNamedValue(blend, "SampleData")).Select(value => (
            Input: ExtractVectorComponent(GetNamedValue(value, "SampleValue"), "X") ?? double.NaN,
            Path: ResolveReferencedPackagePath(GetNamedValue(value, "Animation")))).OrderBy(value => value.Input).ToArray();
        if (samples.Length < 2 || samples.Any(value => !double.IsFinite(value.Input) || string.IsNullOrWhiteSpace(value.Path))
            || samples.Select(value => value.Input).Distinct().Count() != samples.Length
            || minimumPitch < samples[0].Input || maximumPitch > samples[^1].Input) return null;
        try
        {
            var meshPackage = _fileProvider.LoadPackage(ResolvePackagePath(meshReference.MeshPath)!);
            var mesh = meshPackage.GetExports().OfType<USkeletalMesh>().FirstOrDefault();
            if (mesh == null) return null;
            FiringTransform? At(double input)
            {
                var bones = mesh.ReferenceSkeleton.FinalRefBoneInfo;
                var poses = FoxWatchPayloadPoseSampler.Sample(_fileProvider, mesh, ResolvePackagePath(blendPath)!, input, binding);
                var frames = new FiringTransform[bones.Length];
                var points = new Dictionary<string, ManifestComponentTransform>(StringComparer.OrdinalIgnoreCase);
                for (var index = 0; index < bones.Length; index++)
                {
                    var name = bones[index].Name.Text;
                    var local = new FiringTransform(CreateComponentTransform(poses[index]), new(poses[index].Scale3D.X, poses[index].Scale3D.Y, poses[index].Scale3D.Z));
                    frames[index] = bones[index].ParentIndex < 0 ? local : ComposeFiringTransform(frames[bones[index].ParentIndex], local);
                    points[name] = frames[index].Transform;
                }
                // Socket definitions use the same precedence as the reference-pose resolver.
                AppendSkeletalMeshSocketTransforms(points, mesh, points);
                AppendSkeletalMeshSocketTransforms(points, meshPackage.GetExports().Cast<object>().Where(IsSkeletalMeshSocketExport), points);
                var skeletonObject = ResolveObjectReference<USkeleton>(GetNamedValue(mesh, "Skeleton"));
                if (skeletonObject != null) AppendSkeletalMeshSocketTransforms(points, skeletonObject, points);
                var skeletonPath = ResolvePackagePath(ResolveReferencedPackagePath(GetNamedValue(mesh, "Skeleton")));
                if (skeletonPath != null) AppendSkeletalMeshSocketTransforms(points, _fileProvider.LoadPackage(skeletonPath).GetExports().Cast<object>().Where(IsSkeletalMeshSocketExport), points);
                if (!points.TryGetValue(payload.AttachSocketName, out var socket)) return null;
                var parent = ComposeFiringTransform(ResolveFiringReferenceTransform(meshReference, references), new(socket, Vector3.One));
                var localPayload = ExtractRelativeComponentReferenceTransform(payload);
                return ComposeFiringTransform(parent, new(localPayload, new((float)(ParseVectorValue(payload.RelativeScale,"x")??1),(float)(ParseVectorValue(payload.RelativeScale,"y")??1),(float)(ParseVectorValue(payload.RelativeScale,"z")??1))));
            }
            var first = At(minimumPitch); var last = At(maximumPitch);
            if (first == null || last == null) return null;
            var delta = Quaternion.Inverse(first.Value.Transform.Rotation) * last.Value.Transform.Rotation;
            var forward = Vector3.Transform(Vector3.UnitX, delta);
            var pitch = Math.Atan2(forward.Z, Math.Sqrt(forward.X*forward.X+forward.Y*forward.Y))*180/Math.PI;
            var yaw = Math.Atan2(forward.Y, forward.X)*180/Math.PI;
            if (pitch <= 0 || pitch > 90 || Math.Abs(yaw) > 0.05) return null;
            return (first.Value, new() { Animation = animationPath, BlendSpace = blendPath, Bone = binding.Bone,
                InputPitch = minimumPitch, MaxInputPitch = maximumPitch, RequiresDeployment = requiresDeployment,
                PitchSpan = Math.Round(pitch,6), MaximumOrigin = [last.Value.Transform.X/100,last.Value.Transform.Y/100,last.Value.Transform.Z/100] });
        }
        catch { return null; } // Unsupported clips keep their existing reference origin; never invent a deployment pose.
    }
}
