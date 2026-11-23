// CITHELA · Agrupación exclusivamente visual de bloqueos Cloud.
// No calcula disponibilidad ni altera filas; el servidor continúa autorizando acciones.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CithelaBlockGroups=api;
})(typeof window==='object'?window:null,function(){
  const DAY=86400000;
  const MAX_GROUP_MS=10*60*1000;
  const date=iso=>Date.parse(iso||'');
  const days=block=>(date(block.ends_at)-date(block.starts_at))/DAY;
  function eligible(block){
    if(!block||!block.id||!block.created_at||!String(block.reason||'').trim())return false;
    const a=date(block.starts_at),b=date(block.ends_at),created=date(block.created_at);
    return Number.isFinite(a)&&Number.isFinite(b)&&Number.isFinite(created)&&b>a&&
      days(block)>=1&&days(block)<=6.1&&Number.isFinite(days(block));
  }
  function adjacent(a,b){
    if(!eligible(a)||!eligible(b))return false;
    if(String(a.resource_id||'')!==String(b.resource_id||''))return false;
    if(String(a.reason||'').trim()!==String(b.reason||'').trim())return false;
    if(Math.abs(date(a.created_at)-date(b.created_at))>MAX_GROUP_MS)return false;
    return date(a.ends_at)===date(b.starts_at)&&days(a)>=5.8;
  }
  function groupBlocks(input){
    if(!Array.isArray(input))return [];
    const sorted=input.slice().filter(Boolean).sort((a,b)=>date(a.starts_at)-date(b.starts_at));
    const groups=[];
    for(const block of sorted){
      const last=groups[groups.length-1];
      if(last&&last.blocks.length<15&&adjacent(last.blocks[last.blocks.length-1],block)&&
         Math.abs(date(last.blocks[0].created_at)-date(block.created_at))<=MAX_GROUP_MS&&
         date(block.ends_at)-date(last.blocks[0].starts_at)<=90*DAY+2*3600000){
        last.blocks.push(block);
      }else groups.push({id:block.id,blocks:[block]});
    }
    return groups.map(g=>({
      id:g.id,
      blocks:g.blocks,
      grouped:g.blocks.length>=2,
      starts_at:g.blocks[0].starts_at,
      ends_at:g.blocks[g.blocks.length-1].ends_at,
      reason:g.blocks[0].reason,
      resource_id:g.blocks[0].resource_id
    }));
  }
  return Object.freeze({groupBlocks});
});