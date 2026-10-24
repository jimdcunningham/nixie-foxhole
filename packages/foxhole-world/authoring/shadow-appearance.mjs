// Keep map resolution, filter width and shadow contrast independent.
// Finite presets share descriptors; no vendor shader or global state is mutated.
export const shadowAppearanceKey=Symbol.for('foxhole.world.shadow-appearance');
const variants=new WeakMap();
export function shadowAppearanceId(view){const a=view[shadowAppearanceKey];return a?(a.soft?'soft:':'sharp:')+(['light','strong'].includes(a.strength)?a.strength:'medium'):'source';}
export function worldShadowBit(bit,view){
 const a=view[shadowAppearanceKey];if(!a)return bit;
 const lighting=bit.name==='pbrLighting',water=bit.name==='foxholeNativeWater2',sampling=/^shadow(?:Gl)?:/.test(bit.name);
 if(!lighting&&!water&&!sampling)return bit;
 const id=shadowAppearanceId(view);let cache=variants.get(bit);if(!cache)variants.set(bit,cache=new Map());if(cache.has(id))return cache.get(id);
 const strength={light:'0.45',medium:'0.7',strong:'1.0'}[a.strength]||'0.7';
 const next={...bit,name:bit.name+':foxhole:'+id};
 for(const backend of ['gpu','gl'])if(bit[backend]){
  next[backend]={...bit[backend]};
  if(lighting)next[backend].fragment={...bit[backend].fragment,lighting:bit[backend].fragment.lighting.replace('* shadow;','* mix(1.0, shadow, '+strength+');')};
  // The water lobe replaces direct specular energy, so its correction must use
  // exactly the same shadow strength as the original PBR contribution.
  if(water)next[backend].fragment={...bit[backend].fragment,lobePerLight:bit[backend].fragment.lobePerLight.replace('*shadow;','* mix(1.0, shadow, '+strength+');')};
  if(sampling&&a.soft)next[backend].header=bit[backend].header.replace('texel = 1.0 / sp.z','texel = 2.5 / sp.z').replace('texelSize = 1.0 / params.z','texelSize = 2.5 / params.z');
 }
 cache.set(id,next);return next;
}
