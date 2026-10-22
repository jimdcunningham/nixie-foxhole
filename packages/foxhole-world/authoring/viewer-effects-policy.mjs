// These Unreal FX materials need their volumetric shader; rendering their
// helper geometry with ordinary PBR produces the large opaque white cones.
// WaterMeasurement is an Unreal helper/null material. The catalog exporter
// synthesized an opaque emissive light card; it is not a visible building surface.
export function hideViewerEffect(materialName){return /^(LightBeam|LightBeamSpotlight|WaterMeasurement(?::parameter-light)?)$/i.test(materialName);}

// WaterMist needs its native animated CloudShapes mask and dynamic offsets.
// The prepared recipe only contains the circular ParticleAlpha texture; drawing
// it as a generic sprite produces white discs (or opaque patches when spread).
export function hideViewerParticleEffect(system){return system==='War/Content/FX/WaterMist.WaterMist';}

// These prepared images are only input masks for native material graphs. They
// are not faithful standalone RGBA sprites. In particular SimpleParticle's dust
// uses its selected mask as diffuse coverage and native lighting; WaterSplashes
// combines animated/warped masks, foam and depth fading. Spreading the generic
// mask sprites makes these omissions conspicuous as dust swarms and white puffs.
// Gate before texture loading and GPU allocation, across all regions/aliases.
export function unsupportedParticleMaterialReason(name,material={}){
 if(/(?:^|\/)SmallParticles(?:\.|$)/i.test(material.source||'')||/^Dustmotes$/i.test(name))return 'native dust mask and lighting';
 if(/(?:^|\/)WaterSubUvs(?:\.|$)/i.test(material.source||'')||/^WaterSplashes|^WaterfallSplash/i.test(name))return 'native animated water material';
 return null;
}
