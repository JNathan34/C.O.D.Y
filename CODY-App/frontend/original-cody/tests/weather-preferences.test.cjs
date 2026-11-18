'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Weather}=require('../src/weather');
test('chosen weather city avoids inferred IP-location lookups and honors Fahrenheit',async()=>{
 const calls=[];
 const weather=new Weather({fetcher:async url=>{
  calls.push(String(url));
  return {ok:true,json:async()=>url.includes('geocoding')?
   {results:[{name:'London',latitude:51.5,longitude:-0.1}]}:
   {current:{temperature_2m:64,weather_code:3,is_day:1}}};
 }});
 weather.configure({unit:'fahrenheit',city:'London'});
 const result=await weather.current('');
 assert.match(result.reply,/London/);assert.match(result.card.text,/64°F/);
 assert.equal(calls.length,2);assert.ok(calls[0].includes('geocoding-api.open-meteo.com'));
 assert.ok(calls[1].includes('fahrenheit'));
 assert.equal(calls.some(url=>url.includes('ipwho.is')||url.includes('ipapi.co')),false);
});
test('changing weather preferences invalidates previous cached readings',async()=>{
 let queries=0;
 const weather=new Weather({fetcher:async url=>{queries++;return {ok:true,json:async()=>url.includes('geocoding')?{results:[{name:'York',latitude:53.95,longitude:-1.08}]}:{current:{temperature_2m:10,weather_code:0,is_day:1}}};}});
 weather.configure({city:'York',unit:'celsius'});await weather.current();await weather.current();
 assert.equal(queries,2);
 weather.configure({city:'York',unit:'fahrenheit'});await weather.current();
 assert.equal(queries,4);
});