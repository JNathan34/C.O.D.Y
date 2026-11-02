'use strict';
function shouldRecoverPointer({visible,expanded,hit,sleeping,wakeUntil,now,button}){
 return visible&&!expanded&&hit&&button==='left'&&(sleeping||now<wakeUntil);
}
module.exports={shouldRecoverPointer};
