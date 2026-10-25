const invalid=()=>{throw Error('定时设置无效 / Invalid schedule');};
export function normalizeSchedule(value){
  if(!value||!['interval','daily','days','weekly','monthly'].includes(value.kind))invalid();
  const every=value.every??1,unit=value.unit||'hours',time=value.time||'09:00',day=value.day??1,weekday=value.weekday??1,overlap=value.overlap??'skip';
  if(!['skip','wait'].includes(overlap))invalid();
  if(!Number.isInteger(every)||every<1||every>365||!['minutes','hours'].includes(unit)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isInteger(day)||day<1||day>31||!Number.isInteger(weekday)||weekday<0||weekday>6)invalid();
  const anchor=value.anchor||new Date().toLocaleDateString('en-CA');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(anchor)||!Number.isFinite(new Date(anchor+'T12:00:00').getTime()))invalid();
  return {kind:value.kind,every,unit,time,day,weekday,anchor,overlap};
}
// Calendar recurrences use the target computer's local clock, including DST.
export function nextOccurrence(value,after,previous){
  const rule=normalizeSchedule(value),now=new Date(after);
  if(!Number.isFinite(now.getTime()))invalid();
  if(rule.kind==='interval'){
    const step=rule.every*(rule.unit==='minutes'?60000:3600000),base=previous??after;
    return base+Math.max(1,Math.floor((after-base)/step)+1)*step;
  }
  const [hour,minute]=rule.time.split(':').map(Number);
  if(rule.kind==='monthly'){
    for(let month=0;month<3;month++){
      const first=new Date(now.getFullYear(),now.getMonth()+month,1),last=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
      const date=new Date(first.getFullYear(),first.getMonth(),Math.min(rule.day,last),hour,minute);
      if(date.getTime()>after)return date.getTime();
    }
  }
  const anchor=new Date(rule.anchor+'T12:00:00'),dayNumber=d=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);
  for(let days=0;days<=366;days++){
    const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+days,hour,minute);
    if(date.getTime()<=after)continue;
    if(rule.kind==='weekly'&&date.getDay()!==rule.weekday)continue;
    if(rule.kind==='days'&&((dayNumber(date)-dayNumber(anchor))%rule.every+rule.every)%rule.every!==0)continue;
    return date.getTime();
  }
  invalid();
}
