'use strict';
// Also injected into the native drawing JS runtime by patch-drawing-tracking.
function screenMarkState(session,unitOf){
 return (session?.codyScreenMarks()||[]).map(mark=>{
  const units=new Set();
  for(const node of mark.nodes){
   const unit=unitOf(node);
   if(unit&&unit.__sent&&unit.parentNode&&unit.parentNode.tagName!=='defs')units.add(unit.__n);
  }
  // Model existence, not whether its render units arrived in this frame,
  // determines the lifetime of its retained content anchor.
  return {id:mark.id,role:mark.role,bounds:mark.bounds,units:[...units]};
 });
}
module.exports={screenMarkState};
