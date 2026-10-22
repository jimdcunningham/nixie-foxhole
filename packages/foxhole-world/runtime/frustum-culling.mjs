/** Visibility only: no geometry replacement, source retirement, or asset work. */
export function setRegionFrustumCulling(root,enabled){
 const mode=enabled?'gpu':'off';
 function visit(node){if('cull' in node)node.cull=mode;for(const child of node.children||[])visit(child);}
 visit(root);
}
