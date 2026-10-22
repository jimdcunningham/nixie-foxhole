export function createSourceLeasePool(){
const records=new Map(),retiring=new Map();
/** Shared catalog sources remain alive until the final placement owner retires. */
return {lease({load,unload}) {
 const held=new Map();let released=false;
 return {
  get(url){
   if(released)return Promise.reject(Error('Catalog lease released'));
   if(held.has(url))return held.get(url).promise;
   let record=records.get(url);
   if(!record){record={users:0,promise:Promise.resolve(retiring.get(url)).then(()=>load(url)),unload};records.set(url,record);}
   record.users++;held.set(url,record);return record.promise;
  },
  release(){
   if(released)return;released=true;
   for(const [url,record]of held){record.users--;if(record.users)continue;
    // A replacement owner may acquire the same record before its load settles.
    void record.promise.then(async()=>{if(record.users||records.get(url)!==record)return;records.delete(url);const cleanup=Promise.resolve().then(()=>record.unload(url)).catch(()=>{});retiring.set(url,cleanup);await cleanup;if(retiring.get(url)===cleanup)retiring.delete(url);},()=>{if(!record.users&&records.get(url)===record)records.delete(url);}).catch(()=>{});
   }held.clear();
  }
 };
}};
}
