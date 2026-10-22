using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
void Check(bool ok,string message){if(!ok)throw new Exception(message);}
Check(!SceneProbe.HasPlacements(new UInstancedStaticMeshComponent()),"Null instance data created a mesh");
Check(!SceneProbe.HasPlacements(new UInstancedStaticMeshComponent {PerInstanceSMData=[]}),"Empty instance data created a mesh");
Check(!SceneProbe.HasPlacements(new UHierarchicalInstancedStaticMeshComponent {PerInstanceSMData=[]}),"Empty hierarchical foliage created a mesh");
Check(SceneProbe.HasPlacements(new UInstancedStaticMeshComponent {PerInstanceSMData=[new FInstancedStaticMeshInstanceData(FTransform.Identity)]}),"Real origin instance was lost");
Check(SceneProbe.HasPlacements(new UStaticMeshComponent()),"Ordinary static mesh was lost");
Console.WriteLine("PASS empty, null and hierarchical containers omitted; populated instances and static meshes retained");
