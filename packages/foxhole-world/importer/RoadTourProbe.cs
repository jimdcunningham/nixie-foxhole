using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component.SplineMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using System.Text.Json;
using System.Text.RegularExpressions;
public static class RoadTourProbe {
 public static void Run(UObject[] objects,string output){
  var curves=new List<object>();var errors=new List<string>();
  foreach(var c in objects.OfType<USplineMeshComponent>())try{
   var reference=c.GetStaticMesh();if(reference.IsNull||!Regex.IsMatch(reference.Name,"road",RegexOptions.IgnoreCase))continue;
   var mesh=reference.Load<UStaticMesh>();if(mesh?.RenderData==null)continue;
   var transform=c.GetAbsoluteTransform();var bounds=mesh.RenderData.Bounds;if(bounds==null)continue;
   var lo=USplineMeshComponent.GetAxisValueRef(bounds.Origin-bounds.BoxExtent,c.ForwardAxis);
   var hi=USplineMeshComponent.GetAxisValueRef(bounds.Origin+bounds.BoxExtent,c.ForwardAxis);
   if(c.SplineBoundaryMin!=c.SplineBoundaryMax){lo=c.SplineBoundaryMin;hi=c.SplineBoundaryMax;}
   // Same native slice transform as the mesh export, including offsets,
   // spline boundaries, roll and the component's complete parent transform.
   var controlLength=(c.SplineParams.EndPos-c.SplineParams.StartPos).Size()/100f;
   var steps=Math.Clamp((int)Math.Ceiling(controlLength/1.5f),8,128);
   var points=new List<float[]>();
   for(int i=0;i<=steps;i++){
    var slice=c.CalcSliceTransform(lo+(hi-lo)*i/steps);
    var p=transform.TransformPosition(slice.TransformPosition(FVector.ZeroVector));
    float[] v=[p.X/100f,p.Z/100f,-p.Y/100f];if(v.Any(x=>!float.IsFinite(x)))throw new Exception("Non-finite curve point");points.Add(v);
   }
   curves.Add(new{id=c.Outer?.Name+"/"+c.Name,mesh=reference.Name,points});
  }catch(Exception e){errors.Add(c.Outer?.Name+"/"+c.Name+": "+e.Message);}
  Directory.CreateDirectory(Path.Combine(output,"roads"));
  File.WriteAllText(Path.Combine(output,"roads/tour-source.json"),JsonSerializer.Serialize(new{source="Native USplineMeshComponent.CalcSliceTransform, metres, viewer Y-up",curves,errors}));
  Console.WriteLine($"Tour road curves: {curves.Count}; errors: {errors.Count}");
 }
}
