// CNY per million tokens, verified 2026-11-11 against the official price card.
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// Cached input is separate from inputTokens; reasoning is already in outputTokens.
const FLASH={hit:[.02,.04],input:[1,2],output:[4,8]};
const PRO={hit:[.15,.30],input:[4.5,9],output:[13.5,27]};
const HOLIDAYS=new Set(['2026-01-01','2026-01-02','2026-01-03','2026-02-15','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-21','2026-02-22','2026-02-23','2026-04-04','2026-04-05','2026-04-06','2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05','2026-06-19','2026-06-20','2026-06-21','2026-09-25','2026-09-26','2026-09-27','2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07']);
export function isPeak(time){
 const d=new Date(time+8*3600000),day=d.toISOString().slice(0,10);
 if(d.getUTCFullYear()!==2026)return null; // Future holiday schedules require a verified update.
 const hour=d.getUTCHours();return ![0,6].includes(d.getUTCDay())&&!HOLIDAYS.has(day)&&((hour>=9&&hour<12)||(hour>=14&&hour<18));
}
export function estimateMessageCost(usage,model,time){
 if(!Number.isFinite(time)||time<Date.parse('2026-09-19T00:00:00+08:00'))return null;
 const price=['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(model)?FLASH:model==='deepseek-v4-pro'?PRO:null;
 const peak=isPeak(time);if(!price||peak===null)return null;
 const values=[usage?.inputTokens,usage?.cacheReadTokens,usage?.outputTokens];if(values.some(x=>typeof x!=='number'||!Number.isSafeInteger(x)||x<0))return null;
 const i=peak?1:0;return Math.round((values[0]*price.input[i]+values[1]*price.hit[i]+values[2]*price.output[i])*100)/1e8;
}
