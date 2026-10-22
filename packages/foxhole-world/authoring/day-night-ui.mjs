import{advanceDay,dayLighting,clockText}from'./day-night.mjs';
export function installDayNight({view,sun,fill,liveTerrainPass,blocked,onChange}){
 const $=id=>document.getElementById(id);let hour=12,running=true,duration=300,brightness=1,lastShadow=-Infinity,lastUi=-Infinity;
 const sky={skyColor:0xffffff,groundColor:0xffffff,intensity:1,up:{x:0,y:1,z:0}};
 const active=()=>$('lighting').value==='cycle';
 function ui(force=false){const now=performance.now();if(!force&&now-lastUi<150)return;lastUi=now;const state=dayLighting(hour);$('dayReadout').textContent=`${clockText(hour)} · ${state.phase}`;$('dayTime').value=hour;$('dayPlay').textContent=active()&&running?'Pause Cycle':'Play Cycle';$('dayPlay').setAttribute('aria-pressed',String(active()&&running));}
 function apply(refresh=false){if(!active()){ui(true);return;}const s=dayLighting(hour),gain=1+(brightness-1)*(1-s.daylight);Object.assign(sky,{skyColor:s.skyColor,groundColor:s.groundColor,intensity:s.environmentIntensity*gain});if(view.environment!==sky)view.environment=sky;view.background=sky;liveTerrainPass.environment='previous';sun.position.set(...s.position);sun.lookAt({x:0,y:0,z:0});sun.color.setValue(s.lightColor);sun.intensity=s.lightIntensity*gain;fill.color.setValue(s.fillColor);fill.intensity=s.fillIntensity*gain;view.exposure=s.exposure;if(refresh){sun.refreshShadows();lastShadow=performance.now();}ui();}
 function choose(value){hour=value;running=false;$('lighting').value='cycle';onChange();ui(true);}
 $('dayTime').oninput=()=>choose(+$('dayTime').value);
 for(const [id,time]of Object.entries({dayDawn:6.5,dayNoon:12,dayDusk:18,dayNight:0}))$(id).onclick=()=>choose(time);
 $('dayPlay').onclick=()=>{running=active()?!running:true;$('lighting').value='cycle';onChange();ui(true);};
 $('nightBrightness').oninput=()=>{brightness=+$('nightBrightness').value;$('nightValue').textContent=brightness.toFixed(1)+'×';onChange();};
 $('daySpeed').onchange=()=>{duration=+$('daySpeed').value;ui(true);};
 ui(true);
 return{apply,snapshot:()=>({enabled:active(),running:active()&&running,hour,clock:clockText(hour),phase:dayLighting(hour).phase,dayLengthSeconds:duration,nightBrightness:brightness}),
 tick(seconds,now){if(!active()||!running||blocked()){ui();return;}hour=advanceDay(hour,Math.min(seconds,.25),duration);apply();if(now-lastShadow>=250){sun.refreshShadows();lastShadow=now;}}};
}
