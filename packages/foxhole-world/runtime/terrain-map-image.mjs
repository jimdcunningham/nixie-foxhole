/** Borrow the active host image; read again if the mod changes during a load. */
export function createTerrainMapImageSource({loadDefault,initial,signal}){
 let selected=initial;
 return {
  set(loader){if(selected===loader)return false;selected=loader;return true;},
  async read(){for(;;){signal?.throwIfAborted();const loader=selected;const override=await loader?.();signal?.throwIfAborted();if(loader!==selected)continue;const paint=override??await loadDefault();signal?.throwIfAborted();if(loader===selected)return paint;}}
 };
}
