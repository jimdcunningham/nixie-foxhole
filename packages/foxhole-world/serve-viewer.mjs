import path from 'node:path';
import {startWorldBakeServer} from './bake-service.mjs';
const service=await startWorldBakeServer({input:process.env.FOXWATCH_WORLD_INPUT,output:process.env.FOXWATCH_WORLD_OUTPUT||path.resolve(import.meta.dirname,'../extensions/foxhole/public/foxhole/assets/world'),sourceUrl:process.env.FOXWATCH_WORLD_SOURCE_URL,port:Number(process.env.FOXWATCH_WORLD_PORT||4321)});
console.log('Foxhole region viewer '+service.url+'/ab-built/viewer.html');
