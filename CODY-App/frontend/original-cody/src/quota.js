'use strict';
/** Interpret the official account/rateLimits/read response; never guess allowances. */
function inspectQuota(raw, nowMs=Date.now()) {
  const value=raw?.rateLimits || raw?.rateLimitsByLimitId?.codex || raw || {};
  const primary=value.primary || null;
  const secondary=value.secondary || null;
  const fullWindow=(w)=>Boolean(w && Number(w.usedPercent)>=100 && Number(w.resetsAt)*1000>nowMs);
  const blockingWindow=fullWindow(primary)?primary:fullWindow(secondary)?secondary:null;
  return {
    primary: primary && {usedPercent:Number(primary.usedPercent),windowDurationMins:primary.windowDurationMins, resetsAt:primary.resetsAt},
    secondary: secondary && {usedPercent:Number(secondary.usedPercent),windowDurationMins:secondary.windowDurationMins, resetsAt:secondary.resetsAt},
    blocked: Boolean(blockingWindow),
    resetsAt: blockingWindow?.resetsAt || null,
    planType: value.planType || null,
    // Additional credit usage should never be silently substituted for the Plus allowance.
    hasCredits: Boolean(value.credits?.hasCredits)
  };
}
function formatReset(epoch,locale='en-GB',tz='Europe/London'){
  if(!Number.isFinite(Number(epoch)) || Number(epoch)<=0) return 'not provided';
  return new Intl.DateTimeFormat(locale,{timeZone:tz,weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(Number(epoch)*1000));
}
function quotaMessage(info){
  return info?.blocked?`Codex allowance is temporarily used up. It resets ${formatReset(info.resetsAt)} (UK time). Your message was not sent. No extra credits will be purchased.`:'';
}
module.exports={inspectQuota,formatReset,quotaMessage};
