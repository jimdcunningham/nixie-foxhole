import {Matrix} from 'pixi.js';

// Geometry is in the converted local Y/-Z projector basis. Native decal
// texture coordinates use the other ordering: (v, 1-u). Apply this to every
// material texture together so opacity and tangent normals stay registered.
// Early rail exports already baked this turn into all their images.
export function orientDecalMaterial(material, source={}) {
 if ((source.uvQuarterTurns??0)%4===1) return material;
 material.uvTransform=new Matrix(0,1,-1,0,0,1);
 return material;
}
