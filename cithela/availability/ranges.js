// CITHELA · calendario civil para bloqueos prolongados.
// Biblioteca pura: no accede a Supabase, sesiones, ventanas ni almacenamiento.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CithelaBlockRanges=api;
})(typeof window==='object'?window:null,function(){
  const MAX_DAYS=90;
  const CHUNK_DAYS=6; // Servidor: max 7 dias por RPC; 6 evita exceder en cambios DST.
  const DAY=86400000;
  function fail(code){const err=new Error(code);err.code=code;throw err;}
  function parseDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('invalid_date');
    const [y,m,d]=value.split('-').map(Number);
    if(y<2000||y>2100||m<1||m>12||d<1||d>31)fail('invalid_date');
    const t=Date.UTC(y,m-1,d);
    if(new Date(t).toISOString().slice(0,10)!==value)fail('invalid_date');
    return t;
  }
  function fromTime(ms){return new Date(ms).toISOString().slice(0,10);}
  function addDays(date,count){
    if(!Number.isInteger(count)||Math.abs(count)>3650)fail('invalid_count');
    return fromTime(parseDate(date)+count*DAY);
  }
  function daysBetween(start,end){
    return Math.round((parseDate(end)-parseDate(start))/DAY);
  }
  function planRange(from,through,{maxDays=MAX_DAYS,chunkDays=CHUNK_DAYS}={}){
    const start=parseDate(from),end=parseDate(through);
    const count=Math.round((end-start)/DAY)+1;
    if(count<1)fail('invalid_order');
    if(!Number.isInteger(maxDays)||maxDays<1||count>maxDays)fail('range_too_long');
    if(!Number.isInteger(chunkDays)||chunkDays<1||chunkDays>6)fail('invalid_chunk');
    const chunks=[];
    for(let offset=0;offset<count;offset+=chunkDays){
      const days=Math.min(chunkDays,count-offset);
      chunks.push({
        startDate:fromTime(start+offset*DAY),
        lastDate:fromTime(start+(offset+days-1)*DAY),
        endExclusive:fromTime(start+(offset+days)*DAY),
        days
      });
    }
    return {from,through,days:count,chunks};
  }
  function spansOverlap(aStart,aEnd,bStart,bEnd){
    const all=[aStart,aEnd,bStart,bEnd].map(x=>Date.parse(x));
    if(all.some(x=>!Number.isFinite(x)))fail('invalid_time');
    return all[0]<all[3]&&all[1]>all[2];
  }
  return Object.freeze({MAX_DAYS,CHUNK_DAYS,addDays,daysBetween,planRange,spansOverlap});
});