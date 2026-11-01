'use strict';
/** Checks a real browser tool round-trip, without opening new tabs silently. */
async function testFirefoxTools(controller){
 const listed=await controller.execute('browser.listTabs',{}, {origin:'gui'});
 if(listed.cancelled)return listed;
 const tabs=listed.result?.data?.tabs;
 if(!Array.isArray(tabs))throw Error('Firefox extension returned no usable tab list. Check extension and bridge version.');
 if(tabs.length===0)return {ok:true,kind:'extension-verified',tabCount:0,detail:'Firefox tool calls work. There are no C.O.D.Y-owned tabs yet. Ask C.O.D.Y to open a website in Firefox, then test page access again.'};
 const page=await controller.execute('browser.pageInfo',{}, {origin:'gui'});
 if(page.cancelled)return page;
 return {...page,kind:'page-verified',tabCount:tabs.length};
}
module.exports={testFirefoxTools};
