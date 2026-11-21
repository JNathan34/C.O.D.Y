'use strict';

const BLOCKED='This monitor is blocked in Settings → Permissions → Monitor access.';
const contains=(rect,point)=>point.x>=rect.x&&point.x<rect.x+rect.width&&point.y>=rect.y&&point.y<rect.y+rect.height;

class MonitorAccess{
  constructor({screen,engine}){this.screen=screen;this.engine=engine;this.state=null;}

  async refresh(){
    const result=await this.engine.request('monitor-access-state');
    if(!Array.isArray(result?.displays)||!(result.allowedIds===null||Array.isArray(result.allowedIds)))throw Error('Monitor access settings are unavailable.');
    this.state=result;
    return result;
  }

  async configure({mainId,allowedIds}={}){
    if(!(mainId===null||typeof mainId==='string'&&mainId.length<=128)||
      !(allowedIds===null||Array.isArray(allowedIds)&&allowedIds.length<=32&&allowedIds.every(id=>typeof id==='string'&&id.length<=128)))throw Error('Choose monitor access settings.');
    return this.state=await this.engine.request('monitor-access-configure',{mainId,allowedIds});
  }

  get restricted(){return Array.isArray(this.state?.allowedIds);}

  mapped(state=this.state){
    if(!state)return [];
    const displays=this.screen.getAllDisplays();
    return state.displays.map(monitor=>{
      const center={x:Math.round(monitor.x+monitor.width/2),y:Math.round(monitor.y+monitor.height/2)};
      const dip=this.screen.screenToDipPoint(center);
      const display=displays.find(item=>contains(item.bounds,dip));
      if(!display)return {monitor};
      const bounds=this.screen.dipToScreenRect(null,display.bounds);
      const matches=['x','y','width','height'].every(key=>Math.abs(bounds[key]-monitor[key])<=2);
      return {monitor,display:matches?display:null};
    });
  }

  all(state=this.state){
    if(!state)return [];
    if(state.allowedIds===null)return this.screen.getAllDisplays();
    return this.mapped(state).filter(({monitor,display})=>display&&monitor.identified&&state.allowedIds.includes(monitor.id)).map(({display})=>display);
  }

  primary(state=this.state){
    if(!state)return null;
    const allowed=this.all(state);
    const selected=state.mainId&&this.mapped(state).find(({monitor})=>monitor.id===state.mainId)?.display;
    if(selected&&allowed.some(display=>display.id===selected.id))return selected;
    const windowsPrimary=this.screen.getPrimaryDisplay();
    return allowed.find(display=>display.id===windowsPrimary.id)||allowed[0]||null;
  }

  requireDisplay(id,state=this.state){
    const display=id===undefined?this.primary(state):this.all(state).find(item=>String(item.id)===String(id));
    if(!display)throw Error(state?.allowedIds?BLOCKED:'The selected monitor is unavailable.');
    return display;
  }

  allowsPhysicalPoint(point){
    if(!this.state)return false;
    return !this.restricted||this.state.displays.some(monitor=>monitor.identified&&this.state.allowedIds.includes(monitor.id)&&contains(monitor,point));
  }

  allowsPhysicalRect(rect){
    if(!this.state)return false;
    if(!this.restricted)return true;
    if(!rect||!['x','y','width','height'].every(key=>Number.isFinite(rect[key]))||rect.width<=0||rect.height<=0)return false;
    const touched=this.state.displays.filter(monitor=>rect.x<monitor.x+monitor.width&&rect.x+rect.width>monitor.x&&rect.y<monitor.y+monitor.height&&rect.y+rect.height>monitor.y);
    return touched.length>0&&touched.every(monitor=>monitor.identified&&this.state.allowedIds.includes(monitor.id));
  }
}

module.exports={MonitorAccess,BLOCKED};
