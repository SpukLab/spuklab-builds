// Simulación local de configuración profesional. NO es autorización de servidor.
import {validateRate,resolveConsultationRate,availableServices} from "./coverage-rules.mjs";

const EDITORS=new Set(["owner","admin"]);
const IDENTIFIER=/^[a-z0-9][a-z0-9_-]{1,70}$/i;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function moneyToMinor(input){
  const value=String(input??"").trim();
  if(!/^(0|[1-9]\d{0,8})(?:[,.]\d{1,2})?$/.test(value))
    throw new Error("Ingresá un importe positivo, sin separadores de miles y con hasta dos decimales.");
  const [units,cents=""]=value.replace(",",".").split(".");
  return Number(units)*100+Number(cents.padEnd(2,"0"));
}
export function identity(rule){
  return [rule.serviceId,rule.kind,rule.providerId??"",rule.planId??""].join("|");
}
export function createDemoEditor({tenantId,role="owner",tenants=[],providers=[],rules=[]}){
  const tenant=tenants.find(x=>x.tenantId===tenantId);
  if(!tenant||!["owner","admin","operator"].includes(role))throw Error("No existe ese establecimiento o rol");
  const validServices=new Set(availableServices(tenant).map(x=>x.id));
  const allowedProviders=new Map(providers.map(p=>[p.id,p]));
  let rows=rules.filter(r=>r.tenantId===tenantId).map((r,i)=>Object.freeze({
    ...validateRate(r),id:"seed_"+i,version:1
  }));
  let nextId=0;
  const ensureEditor=()=>{if(!EDITORS.has(role))throw Error("Solo propietarios y administradores pueden cambiar tarifas.");};
  const output=()=>rows.map(r=>Object.freeze({...r}));
  const assertSelection=(entry)=>{
    if(!validServices.has(entry.serviceId))throw Error("El servicio no pertenece a este establecimiento.");
    if(entry.kind!=="particular"){
      const p=allowedProviders.get(entry.providerId);
      if(!p||p.kind!==entry.kind||!p.plans.some(x=>x.id===entry.planId)){
        throw Error("Entidad o plan inválido para la modalidad.");
      }
    }
  };
  return Object.freeze({
    tenant,role,canEdit:EDITORS.has(role),
    list:()=>output(),
    save(form){
      ensureEditor();
      if(!form||form.tenantId!==tenantId)throw Error("No se puede editar otro establecimiento.");
      assertSelection(form);
      const record=validateRate({
        tenantId,serviceId:form.serviceId,kind:form.kind,
        providerId:form.kind==="particular"?null:form.providerId,
        planId:form.kind==="particular"?null:form.planId,
        amountMinor:form.status==="a_confirmar"?null:form.amountMinor,
        currency:"ARS",active:form.active!==false,
        status:form.status,validUntil:form.validUntil||null
      });
      const previous=rows.find(r=>r.id===form.id);
      if(form.id&&!previous)throw Error("Esta tarifa no existe en este establecimiento.");
      if(previous&&(!Number.isSafeInteger(form.expectedVersion)||previous.version!==form.expectedVersion))
        throw Error("Otro cambio modificó esta tarifa. Actualizá el listado.");
      if(rows.some(r=>r.id!==form.id&&identity(r)===identity(record)))
        throw Error("Ya existe una tarifa para este servicio, entidad y plan. Editá la existente.");
      const result=Object.freeze({...record,id:previous?.id||"demo_new_"+(++nextId),version:(previous?.version||0)+1});
      rows=previous?rows.map(r=>r.id===result.id?result:r):[...rows,result];
      return Object.freeze({...result});
    },
    changeActivity(id,expectedVersion,active){
      ensureEditor();
      if(typeof active!=="boolean")throw Error("Estado de actividad inválido.");
      const previous=rows.find(r=>r.id===id);
      if(!previous)throw Error("Tarifa inexistente para este establecimiento.");
      if(previous.version!==expectedVersion)throw Error("Otro cambio modificó esta tarifa. Actualizá el listado.");
      const updated=Object.freeze({...previous,active,version:previous.version+1});
      rows=rows.map(r=>r.id===id?updated:r);
      return Object.freeze({...updated});
    },
    archive(id,expectedVersion){return this.changeActivity(id,expectedVersion,false);},
    preview({serviceId,kind,providerId=null,planId=null,today="2026-11-17"}){
      assertSelection({serviceId,kind,providerId,planId});
      return resolveConsultationRate({tenantId,serviceId,kind,providerId,planId,today,rules:rows});
    }
  });
}
