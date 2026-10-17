using System.Reflection;
using System.Text.Json;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

// Optional local source integration: never launch the game, and keep extracted
// proof data out of source control. Blender verifies these source matrices separately.
var pak = Environment.GetEnvironmentVariable("FOXWATCH_TEST_PAK_PATH");
if (string.IsNullOrWhiteSpace(pak)) { Console.WriteLine("Payload source tests skipped: set FOXWATCH_TEST_PAK_PATH"); return; }
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
var exporter = new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance,Options.Create(new FoxWatchOptions { PakDirectoryPath = pak }));
var provider = (CUE4Parse.FileProvider.DefaultFileProvider)typeof(FoxWatchAssetMeshExporter).GetProperty("FileProvider",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(exporter)!;
var sampler = typeof(FoxWatchAssetMeshExporter).Assembly.GetType("FoxWatchService.FoxWatchPayloadPoseSampler")!;
var bindings = (Array)sampler.GetField("Bindings",BindingFlags.Static|BindingFlags.NonPublic)!.GetValue(null)!;
var cases = new[] {
    (Id:"armoredcar2multiw",Mesh:"War/Content/Meshes/Vehicles/SK_ArmoredCar2MultiW",Index:0,Input:15d,Angle:15d),
    (Id:"truckmultic",Mesh:"War/Content/Meshes/Vehicles/SK_TruckMultiC",Index:1,Input:65d,Angle:26d),
    (Id:"gunboat2c",Mesh:"War/Content/Blueprints/Vehicles/Gunboats/Gunboat2C/SK_Gunboat2C",Index:2,Input:20d,Angle:20d),
};
var proofs = new List<object>();
foreach (var item in cases)
{
    var binding = bindings.GetValue(item.Index)!;
    string Read(string name) => (string)binding.GetType().GetProperty(name)!.GetValue(binding)!;
    var metadata = new FoxWatchManifestPayloadPose { Animation = "War/Content/Animation/"+Read("Animation")+".uasset", BlendSpace = "War/Content/Animation/"+Read("BlendSpace")+".uasset", Bone = Read("Bone"), InputPitch = item.Input };
    var pose = exporter.SamplePayloadRenderPose(item.Mesh+".glb",metadata)!;
    Check(pose?.Profile == "payload-firing-ready",item.Id+" did not get a source pose");
    var gun = pose!.Bones!.Single(bone => bone.Name == metadata.Bone);
    var q = gun.RotationQuaternion!;
    var angle = 2*Math.Acos(Math.Clamp(Math.Abs(q[3]),0,1))*180/Math.PI;
    Check(Math.Abs(angle-item.Angle)<0.02,item.Id+" used input pitch as physical elevation");
    Check(pose.Bones.Where(bone => bone.Name.Contains("wheel",StringComparison.OrdinalIgnoreCase)).All(bone => Math.Abs(bone.RotationQuaternion![3])>0.99999 && bone.Location!.All(value => Math.Abs(value)<1e-5)),item.Id+" moved unrelated wheels");
    var mesh = provider.LoadPackage(item.Mesh+".uasset").GetExports().OfType<USkeletalMesh>().Single();
    var local = (FTransform[])sampler.GetMethod("Sample",BindingFlags.Static|BindingFlags.NonPublic)!.Invoke(null,[provider,mesh,metadata.BlendSpace,item.Input,binding])!;
    object Serialize(FTransform t) => new { position=new[]{t.Translation.X*.01,t.Translation.Y*.01,t.Translation.Z*.01},rotation=new[]{t.Rotation.X,t.Rotation.Y,t.Rotation.Z,t.Rotation.W},scale=new[]{t.Scale3D.X,t.Scale3D.Y,t.Scale3D.Z} };
    proofs.Add(new { id=item.Id, bones=mesh.ReferenceSkeleton.FinalRefBoneInfo.Select((bone,index)=>new { name=bone.Name.Text,parent=bone.ParentIndex,rest=Serialize(mesh.ReferenceSkeleton.FinalRefBonePose[index]),posed=Serialize(local[index]) }) });
    metadata.Animation = "unverified";
    Check(exporter.SamplePayloadRenderPose(item.Mesh+".glb",metadata)==null,"Unverified animation binding accepted");
    Console.WriteLine(item.Id+": source firing-ready pose, physical elevation, unrelated bones and binding guard passed");
}
var output = Environment.GetEnvironmentVariable("FOXWATCH_TEST_POSE_PROOF");
if (output != null) File.WriteAllText(output,JsonSerializer.Serialize(proofs));
