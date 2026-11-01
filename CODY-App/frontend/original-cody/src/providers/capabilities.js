'use strict';
const {ACTIONS}=require('../control/policy');
class CapabilityRegistry{
 constructor(){this.entries=new Map(Object.entries(ACTIONS).map(([name,policy])=>[name,{name,provider:'cody-native',availability:'experimental',operations:[name],permission:policy.permission,initialised:true,health:'not-tested-this-run',lastResult:null,fallbackAvailable:false}]));}
 observe({action,status}){const entry=this.entries.get(action);if(!entry)return;if(status==='completed'){entry.availability='available';entry.health='healthy';}else if(status==='failed'){entry.availability='failed';entry.health='failed';}entry.lastResult={status,at:new Date().toISOString()};}
 snapshot(){return [...this.entries.values()].map(entry=>structuredClone(entry));}
}
module.exports={CapabilityRegistry};
