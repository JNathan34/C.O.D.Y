'use strict';
// Original compositions built from the package's primitive scene-graph approach.
function compose(preset){
 const part=(id,primitive,position,scale,color='#009DFF',parentId)=>({id,primitive,position,scale,color,...(parentId?{parentId}:{})});
 if(preset==='computer')return [part('stand','cylinder',[0,-.65,0],[.18,.5,.18],'#64748B'),part('foot','box',[0,-1,0],[1.4,.12,.7],'#334155'),part('screen','box',[0,.15,0],[2.3,1.5,.18],'#1E293B'),part('display','box',[0,0,.65],[.9,.84,.25],'#009DFF','screen'),part('keyboard','box',[0,-1,.9],[2,.12,.65],'#64748B')];
 if(preset==='robot')return [part('body','box',[0,0,0],[1.2,1.3,.6]),part('head','sphere',[0,1,0],[.8,.65,.7]),part('left-eye','sphere',[-.25,.08,.6],[.12,.12,.1],'#FFFFFF','head'),part('right-eye','sphere',[.25,.08,.6],[.12,.12,.1],'#FFFFFF','head'),part('left-arm','cylinder',[-.85,0,0],[.2,.75,.2]),part('right-arm','cylinder',[.85,0,0],[.2,.75,.2]),part('left-leg','box',[-.35,-1.1,0],[.35,.8,.4]),part('right-leg','box',[.35,-1.1,0],[.35,.8,.4])];
 return [part('trunk','cylinder',[0,-.6,0],[.35,1.2,.35],'#8B5A2B'),part('leaves','cone',[0,.5,0],[1.8,2,1.8],'#22C55E')];
}
module.exports={compose};
