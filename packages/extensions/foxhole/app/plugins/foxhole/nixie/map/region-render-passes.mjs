/** Draw every region under one registered pass name and render-graph node.
 * These terrain/shoulder passes draw owned geometry directly, not mesh lists.
 */
export function combineRegionPasses(owners){
 if(owners.length===1)return owners[0];
 return {enabled:true,stage:owners[0].stage,build(graph,io){
  const draws=[];
  for(const owner of owners){const built=[];owner.build({addPass:pass=>built.push(pass)},io);if(built.length!==1)throw Error('A regional geometry pass must build one draw');draws.push(built[0]);}
  const calls=draws.map(draw=>({draw,render:draw.render,prepare:draw.prepare,condition:draw.condition,destroy:draw.destroy})),leader=draws[0];
  leader.condition=session=>calls.some(c=>c.condition?.call(c.draw,session)??true);
  leader.prepare=session=>{for(const c of calls)if(c.condition?.call(c.draw,session)??true)c.prepare?.call(c.draw,session);};
  leader.render=session=>{for(const c of calls)if(c.condition?.call(c.draw,session)??true)c.render.call(c.draw,session);};
  leader.destroy=()=>{for(const c of calls)c.destroy?.call(c.draw);};
  graph.addPass(leader);
 }};
}
