// Cached maps are static once the camera settles. While moving, keep the
// nearest cascade current and spread distant redraws over subsequent frames.
export function shadowCadence(mode,moving,wasMoving){
 if(mode==='continuous')return{update:1,refresh:false};
 if(mode==='staggered')return{update:moving?[1,2,4]:'manual',refresh:!moving&&wasMoving};
 return{update:'manual',refresh:moving};
}
