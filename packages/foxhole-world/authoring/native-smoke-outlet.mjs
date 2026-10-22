// Opening centres measured from the native top-ring vertices (metres/Y-up).
// Only these named mesh revisions are corrected; other emitters keep their source pose.
const openings={IndustrialChimneyFurnace01:[-.003427088,14.539495468,.082952097],IndustrialChimneyFurnace02:[-.001210287,13.280542,-.000246212]};
const cache=new WeakMap();
export function nativeSmokeOutlet(placement,worldData){
 if(placement.system!=='War/Content/FX/smokestack.smokestack'||!worldData)return null;
 let actors=cache.get(worldData);if(!actors){actors=new Map();for(const p of worldData.prototypes||[]){const key=p.path?.match(/\/(IndustrialChimneyFurnace0[12])\.uasset$/)?.[1],local=openings[key];if(!local)continue;for(const row of p.placements||[]){const m=row.matrix,position=[0,1,2].map(i=>m[i]*local[0]+m[i+4]*local[1]+m[i+8]*local[2]+m[i+12]),length=Math.hypot(m[4],m[5],m[6]);actors.set(row.actor,{position,up:[m[4]/length,m[5]/length,m[6]/length]});}}cache.set(worldData,actors);}
 return actors.get(placement.actor)||null;
}
