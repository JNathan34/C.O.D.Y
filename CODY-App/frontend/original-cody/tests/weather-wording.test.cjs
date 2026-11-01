'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {Weather}=require('../src/weather');
function weather(temperature,code=3,isDay=1){return new Weather({fetcher:async url=>({ok:true,json:async()=>url.includes('geocoding')?{results:[{name:'Derby',latitude:52.92,longitude:-1.48}]}:{current:{temperature_2m:temperature,weather_code:code,is_day:isDay}}})});}
test('weather uses a short spoken sentence and retains the compact Celsius card',async()=>{const result=await weather(10).current('Derby');assert.equal(result.reply,"It's 10 degrees and cloudy in Derby.");assert.equal(result.card.text,'10°C');assert.equal(result.card.detail,'Derby');});
test('negative temperatures and one degree sound natural',async()=>{assert.equal((await weather(-1,0,0).current('Derby')).reply,"It's minus 1 degree and clear in Derby.");});
test('rain and snow are spoken as conditions rather than labels',async()=>{assert.equal((await weather(8,63).current('Derby')).reply,"It's 8 degrees and raining in Derby.");assert.equal((await weather(0,73).current('Derby')).reply,"It's 0 degrees and snowing in Derby.");});
