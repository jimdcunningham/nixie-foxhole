import {Material3D,RenderPassBit} from '@pixi/3d';
// beta.2 exposes the dedicated refraction pass to custom material subclasses.
// Its color/depth copies include the native terrain drawn after opaque models.
export class RefractiveWaterMaterial extends Material3D {
 constructor(options={}){super({...options,alphaMode:'blend'});this._passBit=RenderPassBit.BLENDED_REFRACTION;this.state.depthMask=false;}
}
