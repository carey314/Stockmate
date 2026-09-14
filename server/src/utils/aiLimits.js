const value=(key,fallback=0)=>{const raw=process.env[key];if(raw===undefined||raw==='')return fallback;const n=Number(raw);return Number.isFinite(n)&&n>=0?Math.floor(n):fallback;};
const limitFor=(plan,bucket)=>plan==='free'?value(bucket==='core'?'FREE_AI_DAILY_CORE':'FREE_AI_DAILY_OTHER'):value(bucket==='core'?'PRO_AI_DAILY_CORE':'PRO_AI_DAILY_OTHER',bucket==='core'?100:50);
const resetInfo=()=>{const next=new Date();next.setDate(next.getDate()+1);next.setHours(0,0,0,0);return {resetAt:next.toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};};
module.exports={value,limitFor,resetInfo};
