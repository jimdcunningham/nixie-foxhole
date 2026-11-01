const key=value=>String(value||'').replaceAll('\\','/').toLowerCase();
const masters={props:'war/content/materials/environment/props.',tree:'war/content/materials/environment/tree.'};
/** Recognize native master graphs, never asset names or texture suffix guesses. */
export function sharedMaterialProfile(row){
 const expressions=(row.properties?.Expressions||[]).map(e=>key(e?.ObjectPath));
 const family=Object.entries(masters).find(([,prefix])=>expressions.some(e=>e.startsWith(prefix)))?.[0];
 if(!family)return null;
 const textures=row.textures||{},scalars=row.scalars||{},switches=row.switches||{};
 const packed=textures[family==='tree'?'M':'RoughnessUVTexture']?.path;
 const albedo=textures[family==='tree'?'A':'Albedo']?.path;
 if(!packed||!albedo)return null;
 // These branches alter texture coordinates or selective tinting and need a
 // separate graph translation; do not silently apply the ordinary UV recipe.
 const uv=row.colors?.UVTiling;
 if((scalars.Tiling??1)!==1||(uv&&((uv.R??1)!==1||(uv.G??1)!==1))||switches['UseColorMask?'])return null;
 const color=row.colors?.ColorShift;
 if(color&&[color.R,color.G,color.B].some(v=>v!==1))return null;
 if(['MetallicStrength','MetallicLevels','RoughStrength','RoughLevels','RoughAdjust','Opacity Mask Tiling','OverlapOpacity'].some(name=>(scalars[name]??1)!==1))return null;
 if(['Prototype Vehicle?','Top Mat Switch','UseVBlend','Damaged?','DamagedRoughness?'].some(name=>switches[name]===true))return null;
 const masked=row.blend==='BLEND_Masked';
 const alpha=family==='tree'?(switches['Use Alpha Channel?']===true?2:null)
  :masked&&switches["Don't Use Opacity Mask"]===false?(switches['use albedo for Alpha']===true?'albedo':3):null;
 // Legacy RGB albedos need their original alpha recovered separately. Leave
 // that uncommon branch intact rather than pretending an RGB image has holes.
 if(alpha==='albedo')return null;
 return {source:row.path,family,albedo,packed,alpha,
  cutoff:row.properties?.BasePropertyOverrides?.OpacityMaskClipValue??.3333,
  metalChannel:family==='tree'||switches['Use Red Channel for Metalness?']!==false?0:null,
  metal:scalars.Metalness??0,roughChannel:family==='tree'||switches['Use Roughness Texture']===true?1:null,
  rough:scalars.Roughness??.94,roughMultiply:scalars['Roughness Multiply']??1};
}
export function matchingMaterialProfile(material,profiles){
 const source=key(material.extras?.foxholeMaterialSource),albedo=key(material.extras?.foxholeAlbedoSource);
 return profiles.find(p=>key(p.source)===source&&key(p.albedo)===albedo)||null;
}
