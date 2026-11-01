const key=value=>String(value||'').replaceAll('\\','/').toLowerCase();
export function nativeFamily(row,master){return row?.properties?.Expressions?.some(e=>key(e?.ObjectPath).startsWith(key(master)+'.'))===true;}
export function fireStaticProfile(row){
 if(!nativeFamily(row,'War/Content/FX/Materials/FireStatic')||row.blend!=='BLEND_Translucent')return null;
 const s=row.scalars,palette=['Fire01','Fire02','Fire03','Fire04'].map(k=>{const c=row.colors?.[k];return c&&[c.R,c.G,c.B];}),mask=row.textures?.SmokeAlphas01?.path;
 if(!mask||palette.some(c=>!c||!c.every(v=>Number.isFinite(v)&&v>=0))||!['Power','Brightness','Opacity','Tiling','Depth Fade'].every(k=>Number.isFinite(s?.[k])&&s[k]>=0)||s.Power===0||s.Tiling===0)return null;
 return {source:row.path,mask,palette,power:s.Power,brightness:s.Brightness,opacity:Math.min(1,s.Opacity),tiling:s.Tiling,depthFade:s['Depth Fade']/100};
}
