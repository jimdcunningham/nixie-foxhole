// Region-specific water meshes are not consistently prefixed with River:
// UWWRiver2 and HowlCountyLake are native water bodies too. Restrict the name
// match to the game's water mesh directory so props such as water barrels stay.
export function usesDedicatedWaterPass(p){return p.kind!=='building'&&(/\/Meshes\/Environment\/Water\//i.test(p.path||'')&&/river|ocean|lake/i.test(p.name)||['RiverDLHex','RiverCallahans'].includes(p.name));}
