'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Weather}=require('../src/weather');
const {IslandUtilities}=require('../src/island-utilities');
const data={
 daily:{time:['2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22','2026-11-23','2026-11-24'],
  temperature_2m_max:[11,12,13,11,9,8,7],temperature_2m_min:[3,4,5,2,1,0,-1],weather_code:[3,61,1,3,3,3,3]},
 hourly:{time:['2026-11-18T10:00','2026-11-18T11:00','2026-11-18T12:00','2026-11-18T13:00','2026-11-18T14:00','2026-11-18T15:00'],
  temperature_2m:[7,8,9,10,11,10],precipitation_probability:[5,10,20,35,50,15]},
 current:{time:'2026-11-18T10:00'}
};
test('weekly and hourly forecasts contain real validated provider readings',async()=>{
 const calls=[];
 const weather=new Weather({fetcher:async url=>{calls.push(String(url));return {ok:true,json:async()=>url.includes('geocoding')?{results:[{name:'Derby',latitude:52.9,longitude:-1.47}]}:data}}});
 const result=await weather.forecast('Derby');
 assert.equal(result.days.length,7);assert.equal(result.hours.length,6);
 assert.match(result.reply,/Today: 3–11°C/);assert.match(result.reply,/Tomorrow: 4–12°C/);
 assert.match(result.reply,/Next six hours/);assert.match(result.card.detail,/Derby/);
 assert.ok(calls[1].includes('daily='));assert.ok(calls[1].includes('hourly='));
});
test('bad API results never fabricate a weekly forecast',async()=>{
 const weather=new Weather({fetcher:async url=>({ok:true,json:async()=>url.includes('geocoding')?{results:[{name:'Derby',latitude:52.9,longitude:-1.47}]}:{...data,daily:{...data.daily,temperature_2m_max:[NaN]}}})});
 await assert.rejects(weather.forecast('Derby'),/invalid readings/);
});
test('forecasts route locally rather than invoking the AI or screen controls',async()=>{
 const cards=[];
 const weather={forecast:async name=>({reply:'Weather forecast for '+name,card:{kind:'weather',text:'11°C',detail:name}})};
 const utility=new IslandUtilities({weather,showCard:card=>cards.push(card),monitors:{match:()=>null}});
 assert.equal(utility.match('weather forecast in Derby').action,'weather-forecast');
 assert.equal(utility.match('seven-day weather forecast for London').location,'London');
 const result=await utility.run('weather forecast in Derby');
 assert.equal(result.handled,true);assert.equal(cards[0].kind,'weather');
});
