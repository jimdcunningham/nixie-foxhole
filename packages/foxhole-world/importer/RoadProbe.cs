using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Component.SplineMesh;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Materials;
using CUE4Parse_Conversion.Textures;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Diagnostics;
public static class RoadProbe {
 static float[] Point(FVector p)=>[p.X/100f,p.Z/100f,-p.Y/100f];
 public static void Run(UObject[] objects,string output){
  var started=Stopwatch.StartNew();var path=Path.Combine(output,"roads");Directory.CreateDirectory(path);var rows=new List<object>();var materials=new Dictionary<string,object>();var errors=new List<string>();long vertexOffset=0,indexOffset=0;int splineCount=0;double maxSplineMidError=0;
  using(var vw=new BinaryWriter(File.Create(Path.Combine(path,"vertices.bin"))))using(var iw=new BinaryWriter(File.Create(Path.Combine(path,"indices.bin"))))
  foreach(var c in objects.OfType<UStaticMeshComponent>())try{
   var reference=c.GetStaticMesh();if(reference.IsNull||!Regex.IsMatch(reference.Name,"road|bridge",RegexOptions.IgnoreCase))continue;
   var mesh=reference.Load<UStaticMesh>();if(mesh==null)continue;var spline=c as USplineMeshComponent;
   if(!mesh.TryConvert(spline,out var converted)||converted.LODs.Count==0)throw new Exception("No converted LOD");var lod=converted.LODs[0];if(lod.Verts==null||lod.Indices==null||lod.Sections==null)continue;
   var transform=c.GetAbsoluteTransform();var vs=lod.Verts;var indices=lod.Indices.Value;var overrides=c.GetOrDefault<FPackageIndex[]>("OverrideMaterials",[]);
   var sections=new List<object>();foreach(var section in lod.Sections.Value){var material=section.MaterialIndex>=0&&section.MaterialIndex<overrides.Length?overrides[section.MaterialIndex].Load<UMaterialInterface>():section.Material?.Load<UMaterialInterface>();var key=material?.GetPathName()??"default";
    if(!materials.ContainsKey(key)){string? file=null,source=null,normalFile=null;var parameters=new CMaterialParams2();if(material!=null){material.GetParams(parameters,EMaterialFormat.FirstLayer);UTexture? texture=null;parameters.TryGetTexture2d(out texture,CMaterialParams2.Diffuse[0]);if(texture==null){var basic=new CMaterialParams();material.GetParams(basic);texture=basic.Diffuse as UTexture;}if(texture==null)texture=parameters.Textures.FirstOrDefault(x=>Regex.IsMatch(x.Key,"albedo|diffuse|base.?col",RegexOptions.IgnoreCase)).Value as UTexture;if(texture!=null){var decoded=texture.Decode(1024);if(decoded!=null){file="roads/"+texture.Name+".png";source=texture.GetPathName();if(!File.Exists(Path.Combine(output,file)))File.WriteAllBytes(Path.Combine(output,file),decoded.FastPng());}}}if(parameters.TryGetTexture2d(out UTexture? normalTexture,CMaterialParams2.Normals[0])&&normalTexture!=null){var normal=normalTexture.Decode(1024);if(normal!=null){normalFile="roads/"+normalTexture.Name+".png";if(!File.Exists(Path.Combine(output,normalFile)))File.WriteAllBytes(Path.Combine(output,normalFile),normal.FastPng());}}materials[key]=new{file,source,normalFile,scalars=parameters.Scalars,colors=parameters.Colors,switches=parameters.Switches,parameters=parameters.Textures.Keys.ToArray()};}
    sections.Add(new{material=key,start=section.FirstIndex,count=section.NumFaces*3});
   }
   var min=new float[]{float.PositiveInfinity,float.PositiveInfinity,float.PositiveInfinity};var max=new float[]{float.NegativeInfinity,float.NegativeInfinity,float.NegativeInfinity};foreach(var v in vs){var p=Point(transform.TransformPosition(v.Position));for(int a=0;a<3;a++){if(!float.IsFinite(p[a]))throw new Exception("Non-finite position");vw.Write(p[a]);min[a]=Math.Min(min[a],p[a]);max[a]=Math.Max(max[a],p[a]);}vw.Write(v.UV.U);vw.Write(v.UV.V);}
   foreach(var index in indices){if(index>=vs.Length)throw new Exception("Index out of range");iw.Write(index);}
   float[]? start=null,end=null,mid=null;double? error=null;
   if(spline!=null){splineCount++;start=Point(transform.TransformPosition(spline.SplineParams.StartPos));end=Point(transform.TransformPosition(spline.SplineParams.EndPos));mid=Point(transform.TransformPosition(spline.SplineParams.SplineEvalPos(.5f)));
    // Check the midpoint against an independent Hermite equation and offset frame.
    var sp=spline.SplineParams;var h=.5f*(sp.StartPos+sp.EndPos)+.125f*(sp.StartTangent-sp.EndTangent);var direction=(1.5f*(sp.EndPos-sp.StartPos)-.25f*(sp.StartTangent+sp.EndTangent)).GetSafeNormal();var bx=(spline.SplineUpDir^direction).GetSafeNormal();var by=(direction^bx).GetSafeNormal();var ox=(sp.StartOffset.X+sp.EndOffset.X)*.5f;var oy=(sp.StartOffset.Y+sp.EndOffset.Y)*.5f;var expected=Point(transform.TransformPosition(h+ox*bx+oy*by));
    var lo=USplineMeshComponent.GetAxisValueRef(mesh.RenderData.Bounds.Origin-mesh.RenderData.Bounds.BoxExtent,spline.ForwardAxis);var hi=USplineMeshComponent.GetAxisValueRef(mesh.RenderData.Bounds.Origin+mesh.RenderData.Bounds.BoxExtent,spline.ForwardAxis);var distance=spline.SplineBoundaryMin!=spline.SplineBoundaryMax?(spline.SplineBoundaryMin+spline.SplineBoundaryMax)*.5f:(lo+hi)*.5f;var actual=Point(transform.TransformPosition(spline.CalcSliceTransform(distance).TransformPosition(FVector.ZeroVector)));error=Math.Sqrt(actual.Zip(expected,(a,b)=>(a-b)*(a-b)).Sum());maxSplineMidError=Math.Max(maxSplineMidError,error.Value);mid=actual;

   }
   rows.Add(new{name=c.Name,actor=c.Outer?.Name.ToString(),mesh=reference.Name,spline=spline!=null,vertexOffset,vertexCount=vs.Length,indexOffset,indexCount=indices.Length,sections,min,max,start,end,mid,splineMidError=error});vertexOffset+=vs.Length;indexOffset+=indices.Length;
   converted.Dispose();
  }catch(Exception e){errors.Add($"{c.Outer?.Name}/{c.Name}: {e.Message}");}
  File.WriteAllText(Path.Combine(path,"roads.json"),JsonSerializer.Serialize(new{components=rows,materials,vertices=vertexOffset,triangles=indexOffset/3,splineCount,maxSplineMidError,errors,seconds=started.Elapsed.TotalSeconds},new JsonSerializerOptions{WriteIndented=true}));Console.WriteLine($"Roads: {rows.Count}, splines: {splineCount}, vertices: {vertexOffset}, triangles: {indexOffset/3}, midpoint error {maxSplineMidError}, errors: {errors.Count}, seconds: {started.Elapsed.TotalSeconds:F2}");
 }
}
