using System.Diagnostics;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Textures;
using SkiaSharp;
public static class FastAssets {
 static readonly Dictionary<string,DirectMesh> meshes=new();
 static readonly Dictionary<string,object> deferred=new();
 public static double EncodeSeconds,MeshSeconds;public static int EncodeCount,MeshMisses,MeshHits;
 public static DirectMesh Exporter(UStaticMesh mesh,ExporterOptions options) => Cached(mesh.GetPathName(),()=>new DirectMesh(mesh,options));
 public static DirectMesh Exporter(USkeletalMesh mesh,ExporterOptions options) => Cached(mesh.GetPathName(),()=>new DirectMesh(mesh,options));
 static DirectMesh Cached(string key,Func<DirectMesh> create){if(meshes.TryGetValue(key,out var value)){MeshHits++;return value;}var t=Stopwatch.StartNew();value=create();MeshSeconds+=t.Elapsed.TotalSeconds;MeshMisses++;meshes[key]=value;return value;}
 public static byte[] FastPng(this CTexture texture){var t=Stopwatch.StartNew();using var bitmap=texture.ToSkBitmap();using var pixmap=bitmap.PeekPixels();using var data=pixmap.Encode(new SKPngEncoderOptions(SKPngEncoderFilterFlags.NoFilters,1));var bytes=data.ToArray();EncodeSeconds+=t.Elapsed.TotalSeconds;EncodeCount++;return bytes;}
 public static object Stats()=>new{EncodeSeconds,EncodeCount,MeshSeconds,MeshMisses,MeshHits};
 public static string Defer(CUE4Parse.UE4.Assets.Exports.Texture.UTexture texture,string file){deferred[file]=new{source=texture.GetPathName(),file,maxSize=1024};return file;}
 public static void SaveDeferred(string output){System.IO.File.WriteAllText(Path.Combine(output,"deferred-textures.json"),System.Text.Json.JsonSerializer.Serialize(deferred.Values));}
}
