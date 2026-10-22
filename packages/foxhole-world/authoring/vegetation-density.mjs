// Thin only small foliage, using source placement identity rather than cell/order/camera.
export function smallVegetation(prototype){
 return prototype.category==='vegetation'&&!/tree|trunk|vine|ivy/i.test(prototype.name)&&/bush|shrub|grass|flower|ground.?cover|nettle|wheat|corn|reed|cattail|fern|bramble|heather/i.test(prototype.name);
}
export function vegetationPlacementVisible(prototype,row,density='full'){
 if(!smallVegetation(prototype)||!['reduced','minimal'].includes(density))return true;
 let hash=2166136261;const identity=(prototype.file||prototype.name)+'|'+row.matrix.join(',');
 for(let i=0;i<identity.length;i++)hash=Math.imul(hash^identity.charCodeAt(i),16777619);
 return (hash>>>0)/4294967296<(density==='reduced'?.5:.15);
}
export function filterVegetationPlacements(prototype,density){
 if(!smallVegetation(prototype)||!['reduced','minimal'].includes(density))return prototype;
 const placements=prototype.placements.filter(row=>vegetationPlacementVisible(prototype,row,density));
 return placements.length===prototype.placements.length?prototype:{...prototype,placements};
}
