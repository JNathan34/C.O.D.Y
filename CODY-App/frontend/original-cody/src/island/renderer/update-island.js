'use strict';
// Shared by the renderer and its tests; it never starts downloads or installs.
((root)=>{
  class UpdateIslandStatus{
    constructor(now=()=>Date.now()){this.now=now;this.value=null;this.expiresAt=0;}
    set(value){
      if(value.status!==this.value?.status)this.expiresAt=this.now()+({current:8000,error:30000}[value.status]||Infinity);
      this.value={...value};
    }
    card(){
      const value=this.value;
      if(!value?.supported||this.now()>=this.expiresAt)return null;
      const version=value.availableVersion?'v'+value.availableVersion:'New version';
      const progress=Math.round(Math.max(0,Math.min(100,Number(value.progress)||0)));
      const cards={
        checking:{text:'Checking…',detail:'C.O.D.Y. updates',icon:'settings'},
        available:{text:'New update',detail:version+' · Tap to view',icon:'arrow-up'},
        downloading:{text:'Update '+progress+'%',detail:'Downloading · '+version,icon:'arrow-up',progress},
        ready:{text:'Update ready',detail:version+' · Restart to install',icon:'check'},
        installing:{text:'Installing…',detail:'Restarting C.O.D.Y.',icon:'settings'},
        current:{text:'Up to date',detail:'v'+value.currentVersion,icon:'check'},
        error:{text:'Update failed',detail:'Tap for details',tooltip:value.error||'Check your connection and try again.',icon:'shield-alert'}
      };
      const card=cards[value.status];
      return card?{...card,status:value.status}:null;
    }
  }
  if(typeof module==='object'&&module.exports)module.exports={UpdateIslandStatus};
  else root.CODYUpdateStatus=new UpdateIslandStatus();
})(typeof window==='object'?window:globalThis);
