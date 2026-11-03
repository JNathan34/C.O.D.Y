'use strict';
function shouldRecoverPointer({visible,expanded,hit,button}){
 // Touch has no hover pass to make the click-through window interactive first.
 // Open from the native press whether the mascot is awake or sleeping.
 return visible&&!expanded&&hit&&button==='left';
}
module.exports={shouldRecoverPointer};
