export const wrapHour=hour=>((hour%24)+24)%24;
export function advanceDay(hour,seconds,durationSeconds){
 if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(durationSeconds)||durationSeconds<=0)return wrapHour(hour);
 return wrapHour(hour+seconds*24/durationSeconds);
}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const hex=rgb=>rgb.reduce((v,c)=>v*256+Math.round(c),0);
export function dayLighting(hour){
 hour=wrapHour(hour);const angle=(hour-6)*Math.PI/12,elevation=Math.sin(angle),day=smooth(-.12,.28,elevation),high=smooth(.03,.6,elevation),warm=Math.exp(-Math.pow(elevation/.26,2));
 const night=elevation<0,body=night?-1:1;
 const sky=mix(mix([57,76,115],[196,137,115],day*warm),[171,197,211],day*(1-.45*warm));
 const ground=mix([23,32,49],[80,78,63],day);
 const phase=hour<5||hour>=20?'Night':hour<8?'Dawn':hour<17?'Daylight':'Dusk';
 return{hour,phase,elevation,daylight:day,position:[(-650*Math.sin(angle)+950*Math.cos(angle))*body,Math.max(30,Math.abs(1100*elevation)),(500*Math.sin(angle)+600*Math.cos(angle))*body],
 lightColor:night?0xb9cfff:hex(mix([255,145,86],[255,250,241],high)),lightIntensity:night?2*smooth(.02,.6,-elevation):7*smooth(0,.5,elevation),
 skyColor:hex(sky),groundColor:hex(ground),environmentIntensity:.35+.55*day,fillColor:hex(mix([107,140,196],[228,236,242],day)),fillIntensity:.18-.06*day,exposure:1.4-.4*day};
}
export function clockText(hour){const minutes=Math.floor(wrapHour(hour)*60+1e-7)%1440;return`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
