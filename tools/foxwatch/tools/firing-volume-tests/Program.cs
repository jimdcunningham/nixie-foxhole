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
