using System.Numerics;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion.Animations;
using CUE4Parse_Conversion.Animations.PSA;

namespace FoxWatchService;

// Shared by firing-frame extraction and static model baking. Inputs are animation
// blend-space coordinates, not physical gun angles (notably 65 means 26° on TruckMultiC).
internal static class FoxWatchPayloadPoseSampler
{
    internal sealed record Binding(string Blueprint, string Animation, string BlendSpace, string Bone, string[] Branches);
    internal static readonly Binding[] Bindings = [
        new("BPArmoredCar2MultiW_C", "TerrainVehicles/ArmoredCar/ABP_ArmoredCarOffensiveW", "TerrainVehicles/ArmoredCar/BS_ArmoredCar2MultiW_Vertical", "Rocket_GunPivot",
            ["Rocket_GunPivot", "Rocket_Vertical_mid", "Rocket_Vertical_back", "Rocket_Rack", "Rocket_Rack_end", "Rocket_Piston_top", "Rocket_Piston_end"]),
        new("BPTruckMultiC_C", "TruckMulti/ABP_TruckMultiC", "TruckMulti/BS_TuckMultiC_Pitch", "rocketRack_pivot", ["rocketRack_pivot", "piston_bottom"]),
        new("BPGunboat2C_C", "WaterVehicles/Gunboat/ABP_Gunboat2C", "WaterVehicles/Gunboat/BS_Gunboat2C_MainTurret_Vertical", "MainGunVertical", ["MainGunVertical", "MainGunVerticalPistons", "MainGunVerticalBase"]),
    ];
    internal static string PathFor(string path) => "War/Content/Animation/" + path + ".uasset";

    internal static FTransform[] Sample(DefaultFileProvider provider, USkeletalMesh mesh, string blendPath, double input, Binding binding)
    {
        var blend = provider.LoadPackage(blendPath).GetExports().Single(value => value.ExportType == "BlendSpace1D");
        var samples = blend.GetOrDefault<FStructFallback[]>("SampleData", []).Select(value => (
            Input: (double)value.Get<FVector>("SampleValue").X,
            Animation: value.Get<FPackageIndex>("Animation"))).OrderBy(value => value.Input).ToArray();
        if (!double.IsFinite(input) || samples.Length < 2 || samples.Any(value => !double.IsFinite(value.Input))
            || samples.Select(value => value.Input).Distinct().Count() != samples.Length
            || input < samples[0].Input || input > samples[^1].Input)
            throw new InvalidOperationException("Unsupported launcher blend-space domain");
        var low = samples.Last(value => value.Input <= input);
        var high = samples.First(value => value.Input >= input);
        Dictionary<string, FTransform> Read(FPackageIndex index)
        {
            var sequence = index.Load<UAnimSequence>() ?? throw new InvalidOperationException("Missing launcher animation");
            if (sequence.AdditiveAnimType != EAdditiveAnimationType.AAT_None) throw new InvalidOperationException("Additive launcher pose");
            var skeleton = sequence.Skeleton.Load<USkeleton>() ?? throw new InvalidOperationException("Missing launcher skeleton");
            return FAnimationRuntime.LoadAsPoses(skeleton.ConvertAnims(sequence).Sequences.First(), skeleton, 0).Single().Bones
                .ToDictionary(bone => bone.Name, bone => bone.Transform, StringComparer.OrdinalIgnoreCase);
        }
        var lower = Read(low.Animation); var upper = Read(high.Animation);
        var alpha = high.Input == low.Input ? 0 : (float)((input - low.Input) / (high.Input - low.Input));
        var bones = mesh.ReferenceSkeleton.FinalRefBoneInfo;
        // Inherited AnimBlueprints also name branches absent from a particular mesh variant.
        var roots = binding.Branches.Select(name => Array.FindIndex(bones, bone => bone.Name.Text == name)).Where(index => index >= 0).ToArray();
        if (!bones.Any(bone => bone.Name.Text == binding.Bone)) throw new InvalidOperationException("Missing launcher branch");
        var result = mesh.ReferenceSkeleton.FinalRefBonePose.ToArray();
        for (var index = 0; index < bones.Length; index++)
        {
            var inBranch = false;
            for (var parent = index; parent >= 0; parent = bones[parent].ParentIndex)
                if (roots.Contains(parent)) { inBranch = true; break; }
            if (!inBranch) continue;
            if (!lower.TryGetValue(bones[index].Name.Text, out var a) || !upper.TryGetValue(bones[index].Name.Text, out var b))
                throw new InvalidOperationException("Missing launcher animation track");
            var q = Quaternion.Lerp(new(a.Rotation.X,a.Rotation.Y,a.Rotation.Z,a.Rotation.W),new(b.Rotation.X,b.Rotation.Y,b.Rotation.Z,b.Rotation.W),alpha);
            var p = Vector3.Lerp(new(a.Translation.X,a.Translation.Y,a.Translation.Z),new(b.Translation.X,b.Translation.Y,b.Translation.Z),alpha);
            var s = Vector3.Lerp(new(a.Scale3D.X,a.Scale3D.Y,a.Scale3D.Z),new(b.Scale3D.X,b.Scale3D.Y,b.Scale3D.Z),alpha);
            result[index] = new FTransform(new FQuat(q.X,q.Y,q.Z,q.W),new FVector(p.X,p.Y,p.Z),new FVector(s.X,s.Y,s.Z));
        }
        return result;
    }
}
