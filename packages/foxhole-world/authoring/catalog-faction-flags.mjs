// Match the structure's own public marker, never the nearest territory owner.
const capturableIcons=new Set([8,11,12,17,18,19,27,28,29,33,34,35,37,39,45,46,47,51,52,53,54,56,57,58,75,83,84,88,89,90,91,92]);
export function catalogStructureOwner(placement,state){
 const item=state?.items?.find(i=>capturableIcons.has(+i.iconType)&&Math.hypot((i.x-.5)*2184-placement.matrix[12],(.5-i.y)*1890-placement.matrix[14])<=2);
 if(!item||((Number(item.flags)||0)&0x04)||!['COLONIALS','WARDENS'].includes(item.teamId))return null;
 return item.teamId;
}
export function catalogFactionFlag(asset,materialName){
 return /^FlagHanging(?:Colonials|Wardens)(?:TownHall)?$|^FlagWindA$|^GarrisonFlag$/i.test(materialName)
  ||(/^relicbase[123]$/.test(asset)&&materialName==='WaterMeasurement:parameter-light');
}
