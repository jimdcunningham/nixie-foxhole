using System.Numerics;
using FoxWatchService;
void Check(bool value, string message) { if (!value) throw new Exception(message); }
// TanketteCGunner: explicit source limits, independent from the 90-degree planar arc.
var tankette = FoxWatchFiringVolumes.Create([-0.116,0.321,1.75], Quaternion.Identity, -45,45,-15,15)!;
Check(tankette.MinYaw == -45 && tankette.MaxYaw == 45 && tankette.MinPitch == -15 && tankette.MaxPitch == 15, "Source limits changed");
Check(tankette.Origin[2] == 1.75 && tankette.Source == "mount-dynamic-data", "Height or provenance missing");
var full = FoxWatchFiringVolumes.Create([0,0,2], Quaternion.CreateFromAxisAngle(Vector3.UnitZ, MathF.PI / 2), -180,180,-30,20)!;
Check(full.MaxYaw - full.MinYaw == 360 && Math.Abs(full.Orientation[2] - Math.Sqrt(0.5)) < 0.000001, "Full yaw or orientation changed");
Check(FoxWatchFiringVolumes.Create([0,0,0], Quaternion.Identity, -45,45,null,null) == null, "Missing elevation invented a cone");
Check(FoxWatchFiringVolumes.Create([0,0,0], Quaternion.Identity, -45,45,15,-15) == null, "Inverted limits accepted");
Check(FoxWatchFiringVolumes.Create([0,0,0], Quaternion.Identity, -45,45,double.NaN,15) == null, "Nonfinite limits accepted");
Check(FoxWatchFiringVolumes.Create([0,0,0], Quaternion.Identity, 170,-170,-5,15)!.MaxYaw == 190, "Wrapped yaw changed");
Console.WriteLine("Firing-volume extraction checks passed");

FoxWatchFiringVolumes.Rotate(tankette, 90, 1, 2);
Check(Math.Abs(tankette.Origin[0] - 0.679) < 0.00001 && Math.Abs(tankette.Origin[1] - 1.884) < 0.00001 && tankette.Origin[2] == 1.75, "Canonical vehicle frame did not rotate the volume origin");
Check(Math.Abs(tankette.Orientation[2] - Math.Sqrt(0.5)) < 0.000001, "Canonical vehicle frame did not rotate the volume orientation");

foreach (var angle in new double[] {45,75,180}) {
    var cone = FoxWatchFiringVolumes.CreateCone([1,2,3], Quaternion.Identity, angle)!;
    Check(cone.Source == "ai-turret" && cone.ConeHalfAngle == angle && cone.MinPitch == null && cone.MinYaw == null, "AI cone became a mount envelope");
    FoxWatchFiringVolumes.Rotate(cone, 90, 0, 0);
    Check(Math.Abs(cone.Origin[0] + 2) < 0.00001 && cone.Origin[2] == 3, "AI cone frame changed height");
}
foreach (var angle in new double[] {0,181,double.NaN}) Check(FoxWatchFiringVolumes.CreateCone([0,0,0],Quaternion.Identity,angle) == null,"Invalid cone angle accepted");
Console.WriteLine("AI firing-cone extraction checks passed");

var artilleryCone = FoxWatchFiringVolumes.CreateCone([0,0,1],Quaternion.Identity,60,artillery:true)!;
Check(artilleryCone.Source == "ai-artillery" && artilleryCone.ConeHalfAngle == 60,"AI artillery firing angle lost");

var selectSockets=typeof(FoxWatchManifestAssetExtractor).GetMethod("GetFiringSocketNames",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!;
var info=Newtonsoft.Json.Linq.JArray.Parse("""[{"GunnerIndex":2,"MuzzleIndex":0,"SocketName":"S_OtherGun"},{"GunnerIndex":1,"MuzzleIndex":1,"SocketName":"S_SecondBarrel"},{"GunnerIndex":1,"MuzzleIndex":0,"SocketName":"S_Muzzle"}]""");
var sockets=(string[])selectSockets.Invoke(null,[info,1])!;
Check(sockets.SequenceEqual(new[]{"S_Muzzle","S_SecondBarrel"}),"Muzzle lookup mixed weapons or ignored the declared barrel order");
Check(((string[])selectSockets.Invoke(null,[info,3])!).Length==0,"Missing gunner used another weapon's muzzle");
var referenced=FoxWatchFiringVolumes.CreateCone([2.68,-0.01,2.62],Quaternion.Identity,45)!;
referenced.Reference=new(){Origin=[0,0],Heading=0};
FoxWatchFiringVolumes.Rotate(referenced,90,10,20);
Check(Math.Abs(referenced.Origin[0]-10.01)<1e-6&&Math.Abs(referenced.Origin[1]-22.68)<1e-6&&referenced.Origin[2]==2.62,"Canonical correction lost the muzzle offset");
Check(referenced.Reference.Origin.SequenceEqual(new double[]{10,20})&&referenced.Reference.Heading==90,"Canonical correction left the publication reference in the old frame");
Console.WriteLine("Muzzle mapping and canonical reference-frame checks passed");

// Exercise the real private resolver with a cached inspection and no game install.
var flags=System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic;
var temp=Path.Combine(Path.GetTempPath(),"foxwatch-muzzle-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
try {
    var exporter=new FoxWatchAssetMeshExporter(Microsoft.Extensions.Logging.Abstractions.NullLogger<FoxWatchAssetMeshExporter>.Instance,
        Microsoft.Extensions.Options.Options.Create(new FoxWatchOptions{PakDirectoryPath=temp}));
    var extractor=new FoxWatchManifestAssetExtractor(temp,exporter);
    var type=typeof(FoxWatchManifestAssetExtractor);
    var cache=(Dictionary<string,IReadOnlyList<FoxWatchBlueprintComponentReference>>)type.GetField("_blueprintComponentReferencesByPackagePath",flags)!.GetValue(extractor)!;
    var path="War/Content/Blueprints/Fixture.uasset";
    var blueprint=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"Fixture_C","$PackagePath":"War/Content/Blueprints/Fixture.uasset"}""");
    var ai=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"AI","Type":"AITurretComponent"}""");
    var muzzle=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"MuzzleFxLocationComponent","Type":"ArrowComponent"}""");
    var defaults=Newtonsoft.Json.Linq.JObject.Parse("""{"MuzzleFlashLocationComponent":{"ObjectName":"ArrowComponent'Default__Fixture_C:MuzzleFxLocationComponent'"}}""");
    cache[path]=new List<FoxWatchBlueprintComponentReference>{
        new(){ComponentName="Root",ComponentType="SceneComponent",RelativeLocation="X=100 Y=200 Z=300",RelativeRotation="P=0 Y=90 R=0"},
        new(){ComponentName="MuzzleFxLocationComponent",ComponentType="ArrowComponent",AttachParentName="Root",RelativeLocation="X=268 Y=0 Z=262"}
    };
    var lookup=new Dictionary<string,object>{{"AI",ai},{"MuzzleFxLocationComponent",muzzle}};
    var resolver=type.GetMethod("ResolveWeaponFiringFrame",flags)!;
    var resolved=resolver.Invoke(extractor,[new object[]{ai,muzzle},blueprint,defaults,ai,lookup,false])!;
    object Read(object value,string name)=>value.GetType().GetProperty(name)!.GetValue(value)!;
    var transform=Read(resolved,"Transform");
    Check(Math.Abs((double)Read(transform,"X")-100)<0.001&&Math.Abs((double)Read(transform,"Y")-468)<0.001&&(double)Read(transform,"Z")==562,"Nested AI muzzle transform was replaced by the controller origin");
    Check((string)Read(resolved,"Source")=="muzzle-component","Muzzle component provenance missing");
    lookup["OtherAI"]=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"OtherAI","Type":"AITurretComponent"}""");
    Check(resolver.Invoke(extractor,[new object[]{ai,muzzle},blueprint,defaults,ai,lookup,false])==null,"Multiple AI guns incorrectly shared the structure muzzle");
    var mesh="War/Content/Meshes/TestGun.uasset";
    cache[path]=new List<FoxWatchBlueprintComponentReference>{new(){ComponentName="Mesh",ComponentType="SkeletalMeshComponent",MeshType="SkeletalMesh",MeshPath=mesh,RelativeLocation="X=10 Y=20 Z=-50",RelativeRotation="P=0 Y=-90 R=0"}};
    var transformType=type.GetNestedType("ManifestComponentTransform",System.Reflection.BindingFlags.NonPublic)!;
    var bone=Activator.CreateInstance(transformType,[0d,100d,200d,Quaternion.CreateFromAxisAngle(Vector3.UnitZ,MathF.PI/2)])!;
    var boneMap=(System.Collections.IDictionary)Activator.CreateInstance(typeof(Dictionary<,>).MakeGenericType(typeof(string),transformType))!;
    boneMap.Add("S_Muzzle",bone);
    var socketCache=(System.Collections.IDictionary)type.GetField("_skeletalMeshAttachPointTransformsByPackagePath",flags)!.GetValue(extractor)!;
    socketCache.Add(mesh,boneMap);
    type.GetField("_mountedPackagePathByNormalizedPath",flags)!.SetValue(extractor,new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase){{mesh,mesh}});
    var append=type.GetMethods(System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic).Single(m=>m.Name=="AppendSkeletalMeshSocketTransforms"&&m.GetParameters()[1].ParameterType==typeof(IEnumerable<object>));
    var orphan=Newtonsoft.Json.Linq.JObject.Parse("""{"SocketName":"S_Orphan","BoneName":"MissingGunBone","RelativeLocation":{"X":10}}""");
    append.Invoke(null,[boneMap,new object[]{orphan},boneMap]);
    Check(!boneMap.Contains("S_Orphan"),"Shared skeleton socket was attached to a mesh without its gun bone");
    var inheritedMesh=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"Mesh","Properties":{"RelativeRotation":{"Pitch":0,"Yaw":-90,"Roll":0}}}""");
    var readFrames=type.GetMethod("GetFiringComponentReferences",flags)!;
    var localLookup=new Dictionary<string,object>{{"Mesh",inheritedMesh}};
    cache[path][0].RelativeRotation="P=0 Y=0 R=0";
    var frames=(IReadOnlyList<FoxWatchBlueprintComponentReference>)readFrames.Invoke(extractor,[new object[]{inheritedMesh},blueprint,localLookup])!;
    Check(frames[0].RelativeRotation.Contains("Y=-90"),"Materialized native zero overrode an authored Blueprint rotation");
    inheritedMesh["Properties"]!["RelativeRotation"]!["Yaw"]=0;
    cache[path][0].RelativeRotation="P=0 Y=-90 R=0";
    frames=(IReadOnlyList<FoxWatchBlueprintComponentReference>)readFrames.Invoke(extractor,[new object[]{inheritedMesh},blueprint,localLookup])!;
    Check(frames[0].RelativeRotation.Contains("Y=0"),"Explicit Blueprint zero was treated as missing");
    var unknownNative=new CUE4Parse.UE4.Assets.Exports.Component.SkeletalMesh.USkeletalMeshComponent {Name="CharacterMesh0"};
    var knownRefs=cache[path];
    cache[path]=new[]{new FoxWatchBlueprintComponentReference {ComponentName="CharacterMesh0",MeshType="skeletal",MeshPath=mesh,RelativeRotation="P=0 Y=0 R=0"}};
    frames=(IReadOnlyList<FoxWatchBlueprintComponentReference>)readFrames.Invoke(extractor,[new object[]{unknownNative},blueprint,new Dictionary<string,object>{{"CharacterMesh0",unknownNative}}])!;
    Check(frames.Count==0,"Unknown native constructor rotation invented a model-space muzzle");
    cache[path]=knownRefs;
    var socketResolver=type.GetMethod("ResolveFiringSocket",flags)!;
    resolved=socketResolver.Invoke(extractor,[blueprint,"S_Muzzle"])!;
    transform=Read(resolved,"Transform");
    Check(Math.Abs((double)Read(transform,"X")-110)<0.001&&Math.Abs((double)Read(transform,"Y")-20)<0.001&&(double)Read(transform,"Z")==150,"Socket and mesh translations did not compose");
    var q=(Quaternion)Read(transform,"Rotation");
    Check(Math.Abs(Vector3.Transform(Vector3.UnitX,q).Y)<0.001,"Mesh/socket quarter turns did not cancel");
    Check(socketResolver.Invoke(extractor,[blueprint,"MissingSocket"])==null,"Missing socket invented a muzzle");
    cache[path]=cache[path].Concat(new[]{new FoxWatchBlueprintComponentReference{ComponentName="MatchingPart",ComponentType="SkeletalMeshComponent",MeshType="SkeletalMesh",MeshPath=mesh,RelativeLocation="X=10 Y=20 Z=-50",RelativeRotation="P=0 Y=-90 R=0"}}).ToArray();
    Check(socketResolver.Invoke(extractor,[blueprint,"S_Muzzle"])!=null,"Equivalent modular skeletons incorrectly became ambiguous");
    cache[path]=cache[path].Take(1).ToArray();
    cache[path][0].RelativeScale="X=2 Y=3 Z=4";
    resolved=socketResolver.Invoke(extractor,[blueprint,"S_Muzzle"])!;
    transform=Read(resolved,"Transform");
    Check(Math.Abs((double)Read(transform,"X")-310)<0.001&&Math.Abs((double)Read(transform,"Y")-20)<0.001&&(double)Read(transform,"Z")==750,"Nonuniform mesh scale was lost from the muzzle position");
    cache[path][0].RelativeScale=string.Empty;
    cache[path]=cache[path].Concat(new[]{new FoxWatchBlueprintComponentReference{ComponentName="OtherMesh",ComponentType="SkeletalMeshComponent",MeshType="SkeletalMesh",MeshPath=mesh}}).ToArray();
    Check(socketResolver.Invoke(extractor,[blueprint,"S_Muzzle"])==null,"Ambiguous socket selected an unrelated gun mesh");
    var ranks=(Dictionary<string,Dictionary<string,int>>)type.GetField("_firingSocketBoneRanks",flags)!.GetValue(extractor)!;
    var gunMesh="War/Content/Meshes/ActualGun.uasset";
    socketCache.Add(gunMesh,boneMap);
    ((Dictionary<string,string>)type.GetField("_mountedPackagePathByNormalizedPath",flags)!.GetValue(extractor)!)[gunMesh]=gunMesh;
    cache[path]=new[]{
        new FoxWatchBlueprintComponentReference{ComponentName="Tracks",MeshType="skeletal",MeshPath=mesh,RelativeLocation="X=10 Y=20 Z=-50"},
        new FoxWatchBlueprintComponentReference{ComponentName="Gun",MeshType="skeletal",MeshPath=gunMesh}
    };
    ranks[mesh]=new(){{"S_Muzzle",2}};ranks[gunMesh]=new(){{"S_Muzzle",0}};
    resolved=socketResolver.Invoke(extractor,[blueprint,"S_Muzzle"])!;
    transform=Read(resolved,"Transform");
    Check((double)Read(transform,"X")==0&&(double)Read(transform,"Y")==100&&(double)Read(transform,"Z")==200,"Shared track skeleton displaced the socket owned by the gun mesh");
    ranks[mesh]["S_Muzzle"]=0;
    Check(socketResolver.Invoke(extractor,[blueprint,"S_Muzzle"])==null,"Equally owned but different gun frames must remain ambiguous");
    ranks.Clear();
    cache[path]=new[]{
        new FoxWatchBlueprintComponentReference{ComponentName="CharacterMesh0",MeshType="skeletal",MeshPath="War/Content/Meshes/Vehicles/SK_Motorcycle.uasset",AttachParentName="CollisionCylinder",RelativeRotation="P=0 Y=0 R=0"},
        new FoxWatchBlueprintComponentReference{ComponentName="GunMesh",MeshType="skeletal",MeshPath=mesh,AttachParentName="CharacterMesh0",RelativeRotation="P=0 Y=0 R=0"}
    };
    resolved=socketResolver.Invoke(extractor,[blueprint,"S_Muzzle"])!;
    transform=Read(resolved,"Transform");
    Check(Math.Abs((double)Read(transform,"X"))<0.001&&Math.Abs((double)Read(transform,"Y")-100)<0.001,"Legacy planar body inference rotated an explicitly authored model muzzle");
    var mechPath="War/Content/Blueprints/Vehicles/BPMech.uasset";
    var mechBp=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"BPMech_C","$PackagePath":"War/Content/Blueprints/Vehicles/BPMech.uasset"}""");
    var mechDefault=Newtonsoft.Json.Linq.JObject.Parse("""{"MainGunMuzzleLocation":{"ObjectName":"SceneComponent'Default__BPMech_C:MainGunMuzzleLocation'"},"LeftGunMuzzleLocation":{"ObjectName":"SceneComponent'Default__BPMech_C:LeftGunMuzzleLocation'"},"RightGunMuzzleLocation":{"ObjectName":"SceneComponent'Default__BPMech_C:RightGunMuzzleLocation'"}}""");
    cache[mechPath]=new[]{new FoxWatchBlueprintComponentReference{ComponentName="CharacterMesh0",MeshType="skeletal",MeshPath=mesh}}
        .Concat(new[]{"Main","Left","Right"}.Select(side=>new FoxWatchBlueprintComponentReference{ComponentName=side+"GunMuzzleLocation",AttachParentName="CharacterMesh0"})).ToArray();
    for(var i=0;i<3;i++)boneMap.Add(new[]{"S_MainGunMuzzle","S_LeftGunMuzzle","S_RightGunMuzzle"}[i],Activator.CreateInstance(transformType,[(double)i+1,0d,300d,Quaternion.Identity])!);
    for(var seatIndex=1;seatIndex<=3;seatIndex++){
        var seat=Newtonsoft.Json.Linq.JObject.Parse("{\"Name\":\"Seat\",\"Index\":"+seatIndex+"}");
        resolved=resolver.Invoke(extractor,[new object[]{seat},mechBp,mechDefault,seat,new Dictionary<string,object>(),true])!;
        transform=Read(resolved,"Transform");
        Check((double)Read(transform,"X")==seatIndex&&(double)Read(transform,"Z")==300,"Legacy mech seat used a different gun's muzzle");
    }
    cache[path]=new[]{
        new FoxWatchBlueprintComponentReference{ComponentName="CharacterMesh0",ComponentType="SkeletalMeshComponent",MeshType="skeletal",MeshPath=mesh,AnimationClassPath="War/Content/Anim/Fixture.uasset"},
        new FoxWatchBlueprintComponentReference{ComponentName="MechanicalSlot0",ComponentType="AircraftPartSlotComponent",MeshType="skeletal",MeshPath=gunMesh,RelativeLocation="X=500 Y=0 Z=0"}
    };
    ranks[mesh]=new(){{"S_Muzzle",0}};ranks[gunMesh]=new(){{"S_Muzzle",0}};
    var flightDefaults=Newtonsoft.Json.Linq.JObject.Parse("""{"Mesh":{"ObjectName":"SkeletalMeshComponent'Default__Fixture_C:CharacterMesh0'"},"MuzzleInfo":[{"GunnerIndex":1,"MuzzleIndex":0,"SocketName":"S_Muzzle"}]}""");
    var flightSeat=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"GunnerSeat1","Type":"VehicleSeatComponent","Index":1}""");
    resolved=resolver.Invoke(extractor,[new object[]{flightSeat},blueprint,flightDefaults,flightSeat,new Dictionary<string,object>(),true])!;
    Check(resolved!=null,"Aircraft modular part displaced the explicitly bound animated actor mesh");
    transform=Read(resolved!,"Transform");
    Check((double)Read(transform,"X")==0,"Aircraft socket inherited a visual part's placement offset");
    flightDefaults.Remove("Mesh");
    Check(resolver.Invoke(extractor,[new object[]{flightSeat},blueprint,flightDefaults,flightSeat,new Dictionary<string,object>(),true])==null,"Unbound aircraft must not arbitrarily prefer a mesh");
    flightDefaults["Mesh"]=Newtonsoft.Json.Linq.JObject.Parse("""{"ObjectName":"SkeletalMeshComponent'Default__Fixture_C:CharacterMesh0'"}""");
    cache[path][1].AnimationClassPath="War/Content/Anim/IndependentGun.uasset";
    Check(resolver.Invoke(extractor,[new object[]{flightSeat},blueprint,flightDefaults,flightSeat,new Dictionary<string,object>(),true])==null,"An independently animated gun must not be treated as a visual follower");

    var payload=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"PayloadInstancedStaticMesh_GEN_VARIABLE","Type":"PayloadInstancedStaticMeshComponent","$ClassText":"Class'/Script/War.PayloadInstancedStaticMeshComponent'","Rows":2,"Columns":8,"RowSpacing":42,"ColumnSpacing":43.5,"MeshRotation":{"Yaw":-90}}""");
    cache[path]=new[]{
        new FoxWatchBlueprintComponentReference{ComponentName="CharacterMesh0",MeshType="skeletal",MeshPath=mesh},
        new FoxWatchBlueprintComponentReference{ComponentName="PayloadInstancedStaticMesh",ComponentType="PayloadInstancedStaticMeshComponent",MeshType="static",AttachParentName="CharacterMesh0",AttachSocketName="S_Muzzle",RelativeLocation="X=10 Y=0 Z=20"}
    };
    var rocketDefaults=Newtonsoft.Json.Linq.JObject.Parse("""{"PayloadMeshes":{"GunnerIndex":1,"bUseForMuzzleTransform":true},"MuzzleInfo":[{"GunnerIndex":1,"MuzzleIndex":0,"SocketName":"S_RuntimeGenerated0"}]}""");
    resolved=resolver.Invoke(extractor,[new object[]{flightSeat,payload},blueprint,rocketDefaults,flightSeat,new Dictionary<string,object>{{"PayloadInstancedStaticMesh",payload}},true])!;
    Check(resolved!=null,"Runtime payload muzzle binding was ignored because its generated socket is not in the skeleton");
    transform=Read(resolved!,"Transform");
    Check(Math.Abs((double)Read(transform,"Y")-110)<0.001&&(double)Read(transform,"Z")==220,"Payload muzzle lost its socket attachment or local offset");
    Check(Math.Abs(((Quaternion)Read(transform,"Rotation")).Z-Math.Sqrt(0.5))<1e-6,"Visual rocket mesh rotation contaminated the firing axes");
    var payloadOrigins=(double[][])Read(resolved!,"MuzzleOrigins");
    Check(payloadOrigins.Length==16 && Math.Abs(payloadOrigins[7][0]-payloadOrigins[0][0]-3.045)<0.0001 && Math.Abs(payloadOrigins[8][2]-payloadOrigins[0][2]+0.42)<0.0001,"Payload grid did not inherit the socket rotation or row spacing");
    rocketDefaults["PayloadMeshes"]!["GunnerIndex"]=2;
    Check(resolver.Invoke(extractor,[new object[]{flightSeat,payload},blueprint,rocketDefaults,flightSeat,new Dictionary<string,object>{{"PayloadInstancedStaticMesh",payload}},true])==null,"Payload was bound to a different gunner");
    rocketDefaults["PayloadMeshes"]!["GunnerIndex"]=1;
    rocketDefaults["PayloadMeshes"]!["bUseForMuzzleTransform"]=false;
    Check(resolver.Invoke(extractor,[new object[]{flightSeat,payload},blueprint,rocketDefaults,flightSeat,new Dictionary<string,object>{{"PayloadInstancedStaticMesh",payload}},true])==null,"Payload ignored its explicit muzzle-transform opt-out");
    rocketDefaults["PayloadMeshes"]!["bUseForMuzzleTransform"]=true;
    cache[path]=cache[path].Concat(new[]{new FoxWatchBlueprintComponentReference{ComponentName="OtherPayload",ComponentType="PayloadInstancedStaticMeshComponent"}}).ToArray();
    Check(resolver.Invoke(extractor,[new object[]{flightSeat,payload},blueprint,rocketDefaults,flightSeat,new Dictionary<string,object>{{"PayloadInstancedStaticMesh",payload}},true])==null,"Several unassociated payload grids were silently ordered");

    var singleMap=(System.Collections.IDictionary)Activator.CreateInstance(typeof(Dictionary<,>).MakeGenericType(typeof(string),transformType))!;
    singleMap.Add("S_Muzzle",bone);
    socketCache[mesh]=singleMap;
    cache[path]=new[]{new FoxWatchBlueprintComponentReference{ComponentName="GunMesh",MeshType="skeletal",MeshPath=mesh}};
    var loneSeat=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"LoneGunner","Type":"VehicleSeatComponent","Index":1,"Outer":{"ObjectName":"BlueprintGeneratedClass'Fixture_C'"}}""");
    var legacyDefaults=new Newtonsoft.Json.Linq.JObject();
    resolved=resolver.Invoke(extractor,[new object[]{loneSeat},blueprint,legacyDefaults,loneSeat,new Dictionary<string,object>(),true])!;
    Check(resolved!=null,"A sole legacy gun with one canonical source muzzle remained unbound");
    loneSeat["Type"]="StructureSeatComponent";
    Check(resolver.Invoke(extractor,[new object[]{loneSeat},blueprint,legacyDefaults,loneSeat,new Dictionary<string,object>(),true])==null,"Legacy vehicle inference must not promote structure-mounted guns");
    loneSeat["Type"]="VehicleSeatComponent";
    var competitor=Newtonsoft.Json.Linq.JObject.Parse("""{"Name":"OtherGunner","Type":"VehicleSeatComponent","MountCodeName":"UnclassifiedGun","Index":2,"Outer":{"ObjectName":"BlueprintGeneratedClass'Fixture_C'"}}""");
    Check(resolver.Invoke(extractor,[new object[]{loneSeat,competitor},blueprint,legacyDefaults,loneSeat,new Dictionary<string,object>(),true])==null,"A competing or unclassified gunner reused the sole muzzle");
    competitor["bIsEnabled"]=false;
    Check(resolver.Invoke(extractor,[new object[]{loneSeat,competitor},blueprint,legacyDefaults,loneSeat,new Dictionary<string,object>(),true])!=null,"Disabled competing mounts blocked an otherwise unique binding");
    singleMap.Add("S_AnotherMuzzle",bone);
    Check(resolver.Invoke(extractor,[new object[]{loneSeat},blueprint,legacyDefaults,loneSeat,new Dictionary<string,object>(),true])==null,"Multiple source muzzles were silently reduced to the first socket");
    singleMap.Remove("S_AnotherMuzzle");
    legacyDefaults["MuzzleInfo"]=Newtonsoft.Json.Linq.JArray.Parse("""[{"GunnerIndex":1,"SocketName":"S_MissingDeclared"}]""");
    Check(resolver.Invoke(extractor,[new object[]{loneSeat},blueprint,legacyDefaults,loneSeat,new Dictionary<string,object>(),true])==null,"A missing explicit binding was replaced by the legacy canonical socket");

    Console.WriteLine("Nested AI component, mesh/socket composition, quarter-turn and ambiguity checks passed");
} finally { Directory.Delete(temp); }

var physical=FoxWatchFiringVolumes.CreateCone([2,3,4],Quaternion.Identity,45)!;
physical.OriginSource="muzzle-socket";physical.Reference=new(){Origin=[1,2],Heading=0};
FoxWatchFiringVolumes.RotateLegacyRangeFrame(physical,90,10,20);
Check(physical.Origin.SequenceEqual(new double[]{2,3,4})&&physical.Orientation.SequenceEqual(new double[]{0,0,0,1}),"Legacy 2D correction rotated a physical 3D muzzle");
Check(Math.Abs(physical.Reference.Origin[0]-8)<1e-6&&Math.Abs(physical.Reference.Origin[1]-21)<1e-6&&physical.Reference.Heading==90,"Legacy correction failed to update its publication reference");
Console.WriteLine("Blueprint rotation and separate 2D/model frame checks passed");

var authoredRotation=typeof(FoxWatchManifestAssetExtractor).GetMethod("ReadAuthoredFiringRotation",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!;
var nativeMesh=new CUE4Parse.UE4.Assets.Exports.Component.SkeletalMesh.USkeletalMeshComponent();
Check(authoredRotation.Invoke(null,[nativeMesh])==null,"Native default zero masked an omitted Blueprint rotation");
foreach(var yaw in new float[]{0,270}) {
    nativeMesh.Properties.Clear();
    nativeMesh.Properties.Add(new CUE4Parse.UE4.Assets.Objects.FPropertyTag {
        Name=new CUE4Parse.UE4.Objects.UObject.FName("RelativeRotation"),
        Tag=new CUE4Parse.UE4.Assets.Objects.Properties.StructProperty(new CUE4Parse.UE4.Assets.Objects.FScriptStruct(new CUE4Parse.UE4.Objects.Core.Math.FRotator(0,yaw,0)))
    });
    Check(authoredRotation.Invoke(null,[nativeMesh])!=null,"Explicit zero/quarter-turn was lost from native properties");
}
Console.WriteLine("Authored native rotation versus materialized zero checks passed");

var inherited=new CUE4Parse.UE4.Assets.Exports.Component.SkeletalMesh.USkeletalMeshComponent {
    Template=new CUE4Parse.UE4.Assets.ResolvedLoadedObject(nativeMesh)
};
Check(authoredRotation.Invoke(null,[inherited])!=null,"Native component archetype rotation was lost");
Console.WriteLine("Native firing archetype inheritance checks passed");

// Native payload component: row-major index, negative local Y/Z spacing; no artwork rotation.
var squireGrid=FoxWatchPayloadGrid.CreateOffsets(2,5,-39,-28.2)!;
Check(squireGrid.Length==10 && Vector3.Distance(squireGrid[4],new(0,112.8f,0))<0.0001f && Vector3.Distance(squireGrid[5],new(0,0,39))<0.0001f,"Squire payload axes, signs or row-major order changed");
var retiariusGrid=FoxWatchPayloadGrid.CreateOffsets(2,8,42,43.5)!;
Check(retiariusGrid.Length==16 && retiariusGrid[7]==new Vector3(0,-304.5f,0) && retiariusGrid[8]==new Vector3(0,0,-42),"Retiarius payload row rollover changed");
var lucianGrid=FoxWatchPayloadGrid.CreateOffsets(1,6,0,50.5)!;
Check(lucianGrid.Length==6 && lucianGrid[5]==new Vector3(0,-252.5f,0),"Lucian payload spacing changed");
Check(FoxWatchPayloadGrid.CreateOffsets(0,6,0,50.5)==null && FoxWatchPayloadGrid.CreateOffsets(256,1,0,0)==null && FoxWatchPayloadGrid.CreateOffsets(255,255,0,0)==null && FoxWatchPayloadGrid.CreateOffsets(1,1,double.NaN,1)==null,"Malformed payload grid accepted");
Console.WriteLine("Native rocket payload layout checks passed");


// Planner-only pillbox preview clearance must not affect native bunker minimums.
var minimumPolicy=typeof(FoxWatchManifestAssetExtractor).GetMethod("PlannerAiMinimumRange",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!;
foreach(var name in new[]{"BPRiflePillbox_C","BPMGPillbox_C","BPATPillbox_C","BPISGPillbox_C"})
    Check((double)minimumPolicy.Invoke(null,[name,null])! == 400,"Pillbox display cutoff must be 4 metres");
Check(minimumPolicy.Invoke(null,["BPMGAIT2_C",null])==null,"Pillbox override leaked into bunker AI");
Check((double)minimumPolicy.Invoke(null,["BPArtilleryAIT2_C",2500d])! == 2500,"Authored minimum was overwritten");
var coverageVolume=FoxWatchFiringVolumes.CreateCone([2,0,1.1],Quaternion.Identity,35)!;
coverageVolume.OriginSource="muzzle-component";
coverageVolume.Reference=new(){Origin=[0,0],Heading=0};
coverageVolume.Coverage=new(){Origin=[0,0,0],Orientation=[0,0,0,1]};
FoxWatchFiringVolumes.RotateLegacyRangeFrame(coverageVolume,90,1,2);
Check(coverageVolume.Coverage.Origin.SequenceEqual(new double[]{0,0,0}),"Planar-only correction moved model coverage");
FoxWatchFiringVolumes.Rotate(coverageVolume,90,10,20);
Check(coverageVolume.Coverage.Origin.SequenceEqual(new double[]{10,20,0}) && coverageVolume.Origin.SequenceEqual(new double[]{10,22,1.1}),"Coverage and muzzle lost their independent frames");
Check(Math.Abs(coverageVolume.Coverage.Orientation[2]-Math.Sqrt(.5))<1e-6,"Coverage rotation was omitted");
Console.WriteLine("AI component coverage frame and explicit pillbox display override checks passed");
