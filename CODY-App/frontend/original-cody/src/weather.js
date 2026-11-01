'use strict';
function parseWeatherRequest(input){
  let text=String(input||'').trim().replace(/[’']/g,'').replace(/^(?:hey\s+)?c\.?o\.?d\.?y[,!:.?]*\s*/i,'').replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:tell me\s+|show me\s+|check\s+)?/i,'').replace(/[?!.]+$/,'').replace(/\s+please$/i,'').trim();
  text=text.replace(/\s+(?:right now|now|today)$/i,'');
  const match=/^(?:(?:what(?:s| is)|how(?:s| is))\s+)?(?:the\s+)?weather(?:\s+like)?(?:\s+(?:in|for|at)\s+(.+)|\s+(here|near me|outside|at my location))?$/i.exec(text);
  if(!match)return null;
  const location=(match[1]||match[2]||'').trim();
  if(/\b(?:tomorrow|week|next|yesterday|and|then)\b/i.test(location)||location.length>100)return null;
  return {location:/^(?:here|near me|outside|my location|me)$/i.test(location)?'':location};
}
function condition(code,isDay){
  if(code===0)return {description:isDay?'clear skies':'clear skies',icon:isDay?'sun':'moon'};
  if(code===1||code===2)return {description:'partly cloudy',icon:isDay?'cloud-sun':'cloud-moon'};
  if(code===3)return {description:'overcast',icon:'cloud'};
  if([45,48].includes(code))return {description:'foggy',icon:'cloud-fog'};
  if([51,53,55,56,57].includes(code))return {description:'drizzle',icon:'cloud-drizzle'};
  if([61,63,65,66,67,80,81,82].includes(code))return {description:'rain',icon:'cloud-rain'};
  if([71,73,75,77,85,86].includes(code))return {description:'snow',icon:'cloud-snow'};
  if([95,96,99].includes(code))return {description:'thunderstorms',icon:'cloud-lightning'};
  return {description:'current conditions',icon:'cloud'};
}
const validCoordinates=place=>Number.isFinite(place?.latitude)&&Math.abs(place.latitude)<=90&&Number.isFinite(place?.longitude)&&Math.abs(place.longitude)<=180;
class Weather{
  constructor({fetcher=globalThis.fetch,now=Date.now}={}){this.fetcher=fetcher;this.now=now;this.location=null;this.cache=new Map();}
  async json(url){
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(7000),headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('The weather service is unavailable. Please try again shortly.');
    const data=await response.json();if(data.error||data.success===false)throw Error('The weather service could not complete that lookup.');return data;
  }
  async locate(name){
    if(name){
      const data=await this.json('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name,count:'1',language:'en',format:'json'}));
      const place=data.results?.[0];if(!validCoordinates(place))throw Error(`I could not find ${name}. Try a town or city, optionally followed by its country.`);
      return {...place,label:place.name,approximate:false};
    }
    if(this.location&&this.location.expiresAt>this.now())return this.location;
    let place;
    for(const url of ['https://ipwho.is/?fields=success,city,region,latitude,longitude','https://ipapi.co/json/']){
      try{const data=await this.json(url);if(validCoordinates(data)){place=data;break;}}catch{}
    }
    if(!place)throw Error('I could not detect your approximate location. Try asking for weather in a named town or city.');
    this.location={latitude:place.latitude,longitude:place.longitude,label:place.city||place.region||'your area',approximate:true,expiresAt:this.now()+30*60*1000};
    return this.location;
  }
  async current(name=''){
    const key=name.trim().toLowerCase()||'@current-location',cached=this.cache.get(key);
    if(cached&&cached.expiresAt>this.now())return cached.result;
    const place=await this.locate(name);
    const data=await this.json('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:'temperature_2m,weather_code,is_day',temperature_unit:'celsius',timezone:'auto'}));
    const current=data.current;
    if(!Number.isFinite(current?.temperature_2m)||!Number.isInteger(current.weather_code)||![0,1].includes(current.is_day))throw Error('Current weather data is unavailable. Please try again shortly.');
    const weather=condition(current.weather_code,current.is_day===1),temperature=Math.round(current.temperature_2m);
    const spoken={"clear skies":'clear',overcast:'cloudy',rain:'raining',snow:'snowing',thunderstorms:'stormy',drizzle:'drizzly','current conditions':''}[weather.description]??weather.description;
    const degrees=temperature<0?'minus '+Math.abs(temperature):String(temperature);
    const reply=`It's ${degrees} ${Math.abs(temperature)===1?'degree':'degrees'}${spoken?' and '+spoken:''} ${place.approximate?'near':'in'} ${place.label}.`;
    const result={reply,card:{kind:'weather',text:`${temperature}°C`,detail:place.label,icon:weather.icon,tooltip:`${place.label}: ${temperature}°C, ${weather.description}${place.approximate?' (approximate location)':''}. Weather: Open-Meteo.`}};
    this.cache.set(key,{result,expiresAt:this.now()+5*60*1000});if(this.cache.size>32)this.cache.delete(this.cache.keys().next().value);
    return result;
  }
}
module.exports={Weather,parseWeatherRequest,condition};
