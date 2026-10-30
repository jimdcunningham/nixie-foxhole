const valid=s=>Number.isSafeInteger(s?.bytes)&&s.bytes>=0&&Number.isSafeInteger(s?.count)&&s.count>=0;
/** Only crash-safe writers may extend accounting freshness without enumerating. */
export function freshCacheSummary(summary,time,recheck){
 const at=summary?.accountingVersion===2?Math.max(summary.accountedAt,summary.verifiedAt):summary?.verifiedAt;
 return Number.isFinite(at)&&at<=time&&time-at<recheck;
}
export function trackedCacheSummary(previous,next,changes,{time=Date.now(),token=crypto.randomUUID()}={}){
 return {...next,accountingVersion:2,accountedAt:time,revision:token};
}

/** Cache Storage itself serializes enumeration with writes. Reconcile only idle caches. */
export function createCacheEnumeration({name,body,readSummary,writeSummary,readActivity=async()=>0,
 writeActivity=async()=>{},onSnapshot=async()=>{},skipEnumeration=async()=>false,mutate,now,recheck,idleDelay=recheck,
 locks=globalThis.navigator?.locks,setTimer=setTimeout}={}){
 let timer,pending=false,lastActive=-Infinity,lastReported=-Infinity,publishing=false,observed=-Infinity;
 const activityTime=async()=>{try{const t=await readActivity();return Number.isFinite(t)&&t<=now()?t:-Infinity;}catch{return -Infinity;}};
 async function publish(){
  if(publishing||now()>=lastReported&&now()-lastReported<1000)return;
  publishing=true;lastReported=now();
  const run=async()=>{const time=Math.max(lastActive,await activityTime());await writeActivity(time);};
  try{if(locks)await locks.request(name+':activity',run);else await run();}catch{}finally{publishing=false;}
 }
 async function isIdle(){
  let summary;try{summary=await readSummary();}catch{}
  const at=summary?.accountingVersion===2&&Number.isFinite(summary.accountedAt)&&summary.accountedAt<=now()?summary.accountedAt:-Infinity;
  observed=Math.max(lastActive,at,await activityTime());return now()-observed>=idleDelay;
 }
 async function verify(){
  const run=async()=>{
   if(!await isIdle())return false;
   const before=await mutate(readSummary);if(await skipEnumeration(before))return true;
   const keys=await body.keys();
   await mutate(async()=>{
    const current=await readSummary();
    // Any writer, failed commit or old client invalidates this snapshot.
    if(valid(current)&&current.revision&&current.revision===before?.revision){
     if(keys.length===current.count){const {scan,...rest}=current;await writeSummary({...rest,verifiedAt:now()});}
     else await writeSummary(null);
    }
   });
   await onSnapshot(keys);return true;
  };
  return locks?locks.request(name+':accounting',{ifAvailable:true},lock=>lock?run():true):run();
 }
 function schedule(){
  if(timer||pending)return;
  const delay=Math.max(0,Math.max(lastActive,observed)+idleDelay-now());
  timer=setTimer(()=>{
   timer=undefined;pending=true;const startedAt=lastActive;
   void verify().catch(()=>true).then(done=>{pending=false;if(!done||lastActive>startedAt)schedule();});
  },delay);timer?.unref?.();
 }
 function activity(){lastActive=now();void publish();schedule();}
 return {schedule:activity,activity,isIdle,verify};
}
