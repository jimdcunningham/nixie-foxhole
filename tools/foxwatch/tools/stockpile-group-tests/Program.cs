using System.Collections;
using System.Reflection;
using System.Text.Json;
using FoxWatchService;
using Newtonsoft.Json.Linq;

var native = JArray.Parse(File.ReadAllText(args[1]));
var objects = native.Cast<object>().ToArray();
var blueprint = native.OfType<JObject>().Single(o => (string?)o["Type"] == "BlueprintGeneratedClass");
var extractor = new FoxWatchManifestAssetExtractor(args[0]);
var type = typeof(FoxWatchManifestAssetExtractor);
var flags = BindingFlags.NonPublic | BindingFlags.Instance;
int passed = 0;
void Check(bool ok, string message) { if (!ok) throw new Exception(message); passed++; }
JToken Serialize(object value) => JToken.Parse(JsonSerializer.Serialize(value, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
var legacyMethod = type.GetMethod("ExtractStockpile", flags)!;
JToken Legacy(object[] roots, object bp) => Serialize(legacyMethod.Invoke(extractor, [roots, bp])!);
var legacy = Legacy(objects, blueprint);
Check((int?)legacy["totalItemCapacity"] == 0 && legacy["validItems"]!.Values<string>().SequenceEqual(new[]{"Harvester"}), "native legacy loss reproduced without changing compatibility projection");
var groupedMethod = type.GetMethod("ExtractStockpileGroups", flags);
Check(groupedMethod != null, "grouped native stockpile extraction must exist");
JArray Extract(object[] roots, object bp) => (JArray)Serialize(groupedMethod!.Invoke(extractor, [roots, bp])!);
var groups = Extract(objects, blueprint);
Check(groups.Count == 3 && groups.Sum(g => ((JArray)g["configs"]!).Count) == 5, "three native stores retain all five configs");
Check(groups.Select(g => (int)g["stockpileIndex"]!).SequenceEqual(new[]{0,1,2}), "native indexed stockpile fields preserved");
Check(groups[0]["configs"]!.Select(c => (string)c["entryType"]!).SequenceEqual(new[]{"Vehicles","Structures","Items"}), "typed native config order preserved");
Check((int)groups[0]["configs"]![0]!["quantityLimit"]! == 10 && (int)groups[0]["configs"]![0]!["totalQuantityLimit"]! == 0, "zero total is not replaced or interpreted as capacity");
Check((int)groups[0]["configs"]![1]!["quantityLimit"]! == 20 && groups[0]["configs"]![1]!["validEntriesOverride"]!.Count() == 3, "three structure choices and limit retained");
Check(groups.SelectMany(g => g["configs"]!).Where(c => (string?)c["entryType"] == "Items").Select(c => (int)c["totalQuantityLimit"]!).SequenceEqual(new[]{30000,32500,32500}), "resource capacities remain separate");
Check(groups.Skip(1).All(g => (bool)g["allowContainerSubmission"]! && (bool)g["replicates"]!), "native component flags retained");
Check(groups.All(g => g["references"]!.Any(r => ((string)r["componentType"]!).Contains("VehicleAccessBox") && (int)r["stockpileIndex"]! == (int)g["stockpileIndex"]!)), "access box indexes retained");
Check(groups.Skip(1).All(g => g["references"]!.Any(r => ((string)r["componentType"]!).Contains("ResourceGroupRenderComponent"))), "resource render indexes retained");
Check(JToken.DeepEquals(legacy, Legacy(objects, blueprint)), "legacy projection unchanged by additive extraction");
File.WriteAllText(args[2], groups.ToString());

// Exercise the production inherited-property resolver with exact owned component scopes.
var scopeFactory = type.GetMethod("CreateBlueprintComponentScope", BindingFlags.Static | BindingFlags.NonPublic)!;
var cache = (IDictionary)type.GetField("_blueprintComponentScopesByPackagePath", flags)!.GetValue(extractor)!;
var own = (JObject)native.OfType<JObject>().Single(o => (string?)o["Name"] == "GenericStockpileComponent").DeepClone();
var parent = (JObject)own.DeepClone();
parent["Outer"] = new JObject { ["ObjectName"] = "BPBase_C'Default__BPBase_C'" };
var fixtureBp = (JObject)blueprint.DeepClone();
fixtureBp["$PackagePath"] = "fixture.uasset";
JArray Inherited()
{
    var scopes = Array.CreateInstance(scopeFactory.ReturnType, 2);
    scopes.SetValue(scopeFactory.Invoke(null, ["BPLargeShipResourceShip_C","Default__BPLargeShipResourceShip_C","fixture.uasset",new object[]{own}]), 0);
    scopes.SetValue(scopeFactory.Invoke(null, ["BPBase_C","Default__BPBase_C","base.uasset",new object[]{parent}]), 1);
    cache["fixture.uasset"] = scopes;
    return Extract([own], fixtureBp);
}
own["Properties"]!["Configs"] = new JArray();
Check(Inherited()[0]["configs"]!.Count() == 0, "explicit empty configs do not acquire parent entries");
((JObject)own["Properties"]!).Remove("Configs");
Check(Inherited()[0]["configs"]!.Count() == 3, "absent configs inherit from closest component scope");
var config = (JObject)parent["Properties"]!["Configs"]![0]!.DeepClone();
config["QuantityOverrides"] = JArray.Parse("[{\"Key\":\"Harvester\",\"Value\":7}]");
config["TotalQuantityOverrides"] = JArray.Parse("[{\"Key\":\"Harvester\",\"Value\":11}]");
own["Properties"]!["Configs"] = new JArray(config);
var overrideGroup = Inherited();
Check(overrideGroup[0]["configs"]!.Count() == 1, "nearest config array replaces parent rather than appending");
Check((int)overrideGroup[0]["configs"]![0]!["quantityOverrides"]![0]!["Value"]! == 7 && (int)overrideGroup[0]["configs"]![0]!["totalQuantityOverrides"]![0]!["Value"]! == 11, "quantity and total override records remain distinct");
var collision = (JObject)config.DeepClone();collision["Type"]="EStockpileEntryType::Items";
((JArray)own["Properties"]!["Configs"]!).Add(collision);
Check(Inherited()[0]["configs"]!.Count() == 2, "same codename in distinct entry domains is not deduplicated");
Console.WriteLine(JsonSerializer.Serialize(new { passed, failed = 0, stockpiles = 3, configs = 5 }));
