using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;

namespace FoxWatchService;

public sealed partial class FoxWatchAssetMeshExporter
{
    public FoxWatchRenderScenePose? SamplePayloadRenderPose(string meshPath, FoxWatchManifestPayloadPose metadata)
    {
        var binding = FoxWatchPayloadPoseSampler.Bindings.SingleOrDefault(value =>
            FoxWatchPayloadPoseSampler.PathFor(value.Animation) == metadata.Animation
            && FoxWatchPayloadPoseSampler.PathFor(value.BlendSpace) == metadata.BlendSpace && value.Bone == metadata.Bone);
        if (binding == null) return null;
        var mesh = FileProvider.LoadPackage(ResolvePackagePath(NormalizeMeshAssetPath(meshPath)) ?? throw new FileNotFoundException(meshPath)).GetExports().OfType<USkeletalMesh>().SingleOrDefault();
        if (mesh == null || !mesh.ReferenceSkeleton.FinalRefBoneInfo.Any(bone => bone.Name.Text == binding.Bone)) return null;
        var posed = FoxWatchPayloadPoseSampler.Sample(FileProvider, mesh, ResolvePackagePath(metadata.BlendSpace)!, metadata.InputPitch, binding);
        return new()
        {
            Type = "foxhole-bone-pose", Profile = "payload-firing-ready",
            Parameters = new() { ["inputPitch"] = metadata.InputPitch },
            Bones = [.. posed.Select((transform, index) =>
            {
                // Blender matrix_basis is relative to the imported MESH rest pose,
                // which is not necessarily the animation skeleton's reference pose.
                var delta = transform.GetRelativeTransform(mesh.ReferenceSkeleton.FinalRefBonePose[index]);
                var p = SwapYzAndScale(delta.Translation); var swapped = SwapYz(delta.Rotation);
                var q = System.Numerics.Quaternion.Normalize(new(swapped.X,swapped.Y,swapped.Z,swapped.W));
                var scale = NormalizeSerializedRelativeBoneScale(SwapYz(delta.Scale3D),SwapYz(transform.Scale3D),SwapYz(mesh.ReferenceSkeleton.FinalRefBonePose[index].Scale3D));
                return new FoxWatchRenderSceneBonePose { Name = mesh.ReferenceSkeleton.FinalRefBoneInfo[index].Name.Text,
                    ParentIndex = mesh.ReferenceSkeleton.FinalRefBoneInfo[index].ParentIndex,
                    Location = [p.X,p.Y,p.Z], RotationQuaternion = [q.X,q.Y,q.Z,q.W], Scale = [scale.X,scale.Y,scale.Z] };
            })]
        };
    }
}
