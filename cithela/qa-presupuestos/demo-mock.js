// Backend ficticio en memoria. Sin red ni almacenamiento.
(()=>{
const tenant="a1000000-0000-4000-8000-000000000001";
    const patients=[{id:"b1000000-0000-4000-8000-000000000001",tenant_id:tenant,display_name:"Paciente Ficticio A"},
                    {id:"b2000000-0000-4000-8000-000000000002",tenant_id:tenant,display_name:"Paciente Ficticio B"}];
    const catalog=[{id:"cat-demo-1",service_id:null,name:"Limpieza de ejemplo",unit_minor:3500000,currency:"ARS",active:true,updated_at:"2026-11-15T12:00:00Z"}];
    const saved=[];
    window.__quoteQAFailNextList=false;
    window.__quoteQASavedCount=()=>saved.length;
    let versions=0;
    const now=()=>new Date(Date.now()+versions++).toISOString();
    class Query{
      constructor(table){this.table=table;this.conditions=[];this.onlyOne=false;this.cap=Infinity;}
      select(){return this;}
      eq(field,value){this.conditions.push([field,value]);return this;}
      order(){return this;}
      limit(n){this.cap=n;return this;}
      single(){this.onlyOne=true;return this;}
      then(resolve,reject){
        const rows={cithela_tenant_memberships:[{tenant_id:tenant,role:"owner",created_at:"2026-11-15T00:00:00Z"}],
          cithela_tenants:[{id:tenant,display_name:"Consultorio Ficticio",status:"active"}],
          cithela_people:patients,
          cithela_services:[{id:"service-demo-1",tenant_id:tenant,name:"Limpieza de ejemplo",active:true}]
        }[this.table]||[];
        const results=rows.filter(row=>this.conditions.every(([field,value])=>row[field]===value)).slice(0,this.cap);
        return Promise.resolve({data:this.onlyOne?(results[0]||null):results,error:null}).then(resolve,reject);
      }
    }
    const api={
      auth:{
        getSession:async()=>({data:{session:{user:{id:"staff-demo"}}},error:null}),
        onAuthStateChange:callback=>{
          window.__quoteQAEmitAuth=callback;
          return {data:{subscription:{unsubscribe(){}}}};
        }
      },
      from:table=>new Query(table),
      rpc:async(name,{p_tenant_id,p_command,p_payload})=>{
        if(name!=="cithela_quote_command"||p_tenant_id!==tenant)return {data:{ok:false,code:"forbidden"},error:null};
        switch(p_command){
          case "settings.get":return {data:{ok:true,dental_enabled:true},error:null};
          case "catalog.list":return {data:{ok:true,catalog},error:null};
          case "quote.list":
            if(window.__quoteQAFailNextList){
              window.__quoteQAFailNextList=false;
              return {data:null,error:{message:"Simulated loss of quote history connection"}};
            }
            return {data:{ok:true,quotes:saved
              .filter(x=>!p_payload.person_id||x.person_id===p_payload.person_id)
              .slice().reverse()},error:null};
          case "quote.save":{
            const subtotal=p_payload.items.reduce((sum,x)=>sum+x.unit_minor*x.quantity,0);
            const total=subtotal-p_payload.discount_minor;
            let quote=p_payload.id?saved.find(x=>x.id===p_payload.id):null;
            if(!quote){
              const sequence=saved.length+1;
              quote={
                id:"c1000000-0000-4000-8000-"+String(sequence).padStart(12,"0"),
                reference:"P-DEMO-"+String(sequence).padStart(4,"0"),
                created_at:now(),status:"borrador"
              };
              saved.push(quote);
            }
            Object.assign(quote,{person_id:p_payload.person_id,items:p_payload.items.map(x=>({...x,total_minor:x.unit_minor*x.quantity})),
              subtotal_minor:subtotal,discount_minor:p_payload.discount_minor,total_minor:total,
              validity_days:p_payload.validity_days,updated_at:now(),currency:"ARS",dental_coverage:p_payload.dental_coverage??null});
            return {data:{ok:true,code:"saved",id:quote.id,reference:quote.reference,
                status:quote.status,updated_at:quote.updated_at,total_minor:total},error:null};
          }
          case "quote.status":{
            const quote=saved.find(q=>q.id===p_payload.id);
            if(!quote)return {data:{ok:false,code:"not_found"},error:null};
            quote.status=p_payload.status;quote.updated_at=now();
            return {data:{ok:true,code:"status_updated",id:quote.id,status:quote.status,updated_at:quote.updated_at},error:null};
          }
          case "catalog.upsert":{
            let item=p_payload.id?catalog.find(x=>x.id===p_payload.id):null;
            if(!item){item={id:"cat-demo-"+(catalog.length+1),currency:"ARS",active:true};catalog.push(item);}
            Object.assign(item,{name:p_payload.name,service_id:p_payload.service_id||null,unit_minor:p_payload.unit_minor,updated_at:now()});
            return {data:{ok:true,catalog_item:item},error:null};
          }
          case "catalog.archive":{
            const item=catalog.find(x=>x.id===p_payload.id);
            if(!item)return {data:{ok:false,code:"not_found"},error:null};
            item.active=false;item.updated_at=now();
            return {data:{ok:true,catalog_item:item},error:null};
          }
          default:return {data:{ok:false,code:"unsupported_command"},error:null};
        }
      }
    };
    window.supabase={createClient:()=>api};
})();
