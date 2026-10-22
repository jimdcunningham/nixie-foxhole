using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Component.SplineMesh;
using Newtonsoft.Json;
using System.Text.RegularExpressions;
using System.Diagnostics;
var timer=Stopwatch.StartNew();
using var provider=new DefaultFileProvider(args[0],SearchOption.TopDirectoryOnly,new VersionContainer(EGame.GAME_UE4_24),StringComparer.OrdinalIgnoreCase);
provider.Initialize();provider.Mount();PropertyUtil.SearchPropertyInTemplate=true;
var objects=provider.LoadPackage("War/Content/Maps/Master/"+(args.Length>3?args[3]:"DeadlandsHex")+".umap").GetExports().ToArray();
Directory.CreateDirectory(args[1]);if(args.Length>2&&args[2]=="rails"){Rails.Run(provider,args[1]);return;}if(args.Length>2&&args[2] is "coverage" or "effects"){Coverage.Run(objects,args[1],args[2]=="effects");if(args[2]=="effects")EffectsProbe.Run(provider,objects,args[1]);return;}
File.WriteAllText(Path.Combine(args[1],"rail-properties.json"),JsonConvert.SerializeObject(objects.Where(o=>Regex.IsMatch(o.ExportType,"RailTrack|Rail01|RailBumper")||Regex.IsMatch(o.Outer?.Name.ToString()??"","RailTrack|Rail01|RailBumper")),Formatting.Indented));
File.WriteAllText(Path.Combine(args[1],"source-classes.json"),JsonConvert.SerializeObject(objects.GroupBy(o=>o.ExportType).Select(g=>new{type=g.Key,count=g.Count()}).OrderByDescending(g=>g.count),Formatting.Indented));
Console.WriteLine($"Objects {objects.Length}, splines {objects.OfType<USplineMeshComponent>().Count()}, seconds {timer.Elapsed.TotalSeconds:F2}");
Console.WriteLine(string.Join("\n",objects.Where(o=>o.ExportType.EndsWith("_C")&&Regex.IsMatch(o.ExportType,"Spline|Rail")).GroupBy(o=>o.ExportType).Select(g=>$"{g.Key}: {g.Count()}")));

File.WriteAllText(Path.Combine(args[1],"spline-related-properties.json"),JsonConvert.SerializeObject(objects.Where(o=>o.Properties.Any(p=>Regex.IsMatch(p.Name.Text,"Spline|Biarc|ControlPoint|EndPoint|Rail|SavedStructure|TargetLocation",RegexOptions.IgnoreCase))).Select(o=>new {name=o.Name,type=o.ExportType,template=o.Template?.GetFullName(),properties=o.Properties.Where(p=>Regex.IsMatch(p.Name.Text,"Spline|Biarc|ControlPoint|EndPoint|Rail|SavedStructure|TargetLocation",RegexOptions.IgnoreCase))}),Formatting.Indented));
File.WriteAllText(Path.Combine(args[1],"rail-templates.json"),JsonConvert.SerializeObject(objects.Where(o=>Regex.IsMatch(o.ExportType,"RailTrack")).Select(o=>new{name=o.Name,template=o.Template?.GetFullName(),templateObject=o.Template?.Object?.Value,connector=o.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex?>("SplineConnector")?.Load(),splineTarget=o.GetOrDefault<CUE4Parse.UE4.Objects.Core.Math.FVector>("SplineTarget")}),Formatting.Indented));
Console.WriteLine(string.Join("\n",provider.Files.Keys.Where(k=>k.Contains("Deadland",StringComparison.OrdinalIgnoreCase))));

var nextwar=provider.LoadPackage("War/Content/Maps/Master/NextWarRegionData/DeadLandsHexNextWarRegionData.uasset").GetExports().ToArray();File.WriteAllText(Path.Combine(args[1],"nextwar.json"),JsonConvert.SerializeObject(nextwar,Formatting.Indented));
Console.WriteLine("Nextwar "+string.Join(",",nextwar.Select(o=>o.Name+":"+o.ExportType)));
var map=(CUE4Parse.UE4.Assets.Package)provider.LoadPackage("War/Content/Maps/Master/DeadlandsHex.umap");using var raw=provider.CreateReader("War/Content/Maps/Master/DeadlandsHex.umap");var ar=new CUE4Parse.UE4.Assets.Readers.FAssetArchive(raw,map);var tails=new List<object>();
foreach(var export in map.ExportMap.Where(e=>Regex.IsMatch(e.ObjectName.Text,"BPRailTrack|BPPreplacedRailTrack|BPNoVisRail|SplineConnector"))){ar.Position=export.SerialOffset;var obj=new UObject();obj.Deserialize(ar,export.SerialOffset+export.SerialSize);var remaining=export.SerialOffset+export.SerialSize-ar.Position;var bytes=ar.ReadBytes((int)remaining);tails.Add(new{name=export.ObjectName.Text,export.SerialSize,remaining,hex=Convert.ToHexString(bytes),floats=Enumerable.Range(0,bytes.Length/4).Select(i=>BitConverter.ToSingle(bytes,i*4)).ToArray()});}
File.WriteAllText(Path.Combine(args[1],"rail-tails.json"),JsonConvert.SerializeObject(tails,new JsonSerializerSettings{FloatFormatHandling=FloatFormatHandling.String}));
File.WriteAllText(Path.Combine(args[1],"world-settings.json"),JsonConvert.SerializeObject(objects.Where(o=>Regex.IsMatch(o.ExportType,"WorldSettings|LevelScript|Level$|World$|Data")),Formatting.Indented));Console.WriteLine("World/settings types: "+string.Join(",",objects.Where(o=>Regex.IsMatch(o.ExportType,"WorldSettings|LevelScript|Level$|World$|Data")).Select(o=>o.ExportType)));
File.WriteAllText(Path.Combine(args[1],"source-actor-property-names.json"),JsonConvert.SerializeObject(objects.Where(o=>o.ExportType.EndsWith("_C")).GroupBy(o=>o.ExportType).Select(g=>new{type=g.Key,count=g.Count(),properties=g.SelectMany(o=>o.Properties.Select(p=>p.Name.Text)).Distinct().ToArray()}),Formatting.Indented));
File.WriteAllLines(Path.Combine(args[1],"relevant-pak-files.txt"),provider.Files.Keys.Where(k=>Regex.IsMatch(k,"rail|world.*data|region.*data|save|persistent|map.*config|map.*structure",RegexOptions.IgnoreCase)));
var packs=new[]{"War/Content/Materials/Decals/Rail01.uasset","War/Content/Blueprints/Structures/Rail/BPPreplacedRailTrackSplineBiarc.uasset"};foreach(var file in packs){var all=provider.LoadPackage(file).GetExports().ToArray();File.WriteAllText(Path.Combine(args[1],Path.GetFileNameWithoutExtension(file)+"-blueprint.json"),JsonConvert.SerializeObject(all,Formatting.Indented));}


