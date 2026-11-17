// CITHELA: modelo puro de tarifas para solicitudes de turno en salud.
// Sin conexiones, identidad de pacientes ni autorizaciones automáticas.
const KINDS = ["particular","obra_social","prepaga"];
const PROFILES = ["odontologia","medicina","psicologia"];
const UUIDISH = /^[a-z0-9][a-z0-9_-]{1,70}$/i;
const MAX_MINOR = 100000000000;
export const HEALTH_PROFILES = Object.freeze([...PROFILES]);
export const COVERAGE_KINDS = Object.freeze([...KINDS]);

const isId=v=>typeof v==="string"&&UUIDISH.test(v);
function validIsoDate(v){
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const day=new Date(v+"T12:00:00Z");
  return !Number.isNaN(day.getTime())&&day.toISOString().slice(0,10)===v;
}
function minor(v){
  if(!Number.isSafeInteger(v)||v<0||v>MAX_MINOR)throw Error("Importe inválido");
  return v;
}
export function validateRate(rule){
  if(!rule||!isId(rule.tenantId)||!isId(rule.serviceId)||!KINDS.includes(rule.kind))throw Error("Regla inválida");
  if(!["particular","obra_social","prepaga"].includes(rule.kind))throw Error("Modalidad inválida");
  if(rule.kind==="particular"){
    if(rule.providerId!==null||rule.planId!==null)throw Error("Particular sin entidad");
  }else if(!isId(rule.providerId)||!isId(rule.planId)){
    throw Error("Prestador y plan requeridos");
  }
  if(rule.amountMinor!==null)minor(rule.amountMinor);
  if(typeof rule.active!=="boolean"||typeof rule.currency!=="string"||rule.currency!=="ARS")throw Error("Estado/moneda inválidos");
  if(rule.status!=="orientativo"&&rule.status!=="a_confirmar")throw Error("Estado de precio inválido");
  if(rule.status==="a_confirmar"&&rule.amountMinor!==null)throw Error("Precio no verificado");
  if(rule.validUntil!==null&&!validIsoDate(rule.validUntil))throw Error("Fecha de convenio inválida");
  return Object.freeze({...rule});
}
function formatARS(amount){
  return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:2}).format(amount/100);
}
/**
 * Cotización orientativa. Las reglas deben suministrarse desde el servidor
 * solo para un establecimiento habilitado; el cliente no puede modificar
 * valores ni confirmar afiliación. Sin coincidencia exacta: no informa precio.
 */
export function resolveConsultationRate({tenantId,serviceId,kind="particular",providerId=null,planId=null,rules=[],today="2026-11-17"}){
  if(!isId(tenantId)||!isId(serviceId)||!KINDS.includes(kind)||!validIsoDate(today)){
    throw Error("Selección inválida");
  }
  if(kind!=="particular"&&(!isId(providerId)||!isId(planId))){
    return Object.freeze({state:"requires_selection",amountMinor:null,label:"Seleccioná entidad y plan.",warning:""});
  }
  // Nunca se reutiliza el arancel particular como si fuese un copago.
  const eligible=rules.filter(r=>r.tenantId===tenantId&&r.serviceId===serviceId&&r.kind===kind&&r.active===true&&
    (r.validUntil===null||r.validUntil>=today)&&
    (kind==="particular"?r.providerId===null&&r.planId===null:r.providerId===providerId&&r.planId===planId));
  if(eligible.length!==1){
    return Object.freeze({state:"contact",amountMinor:null,label:"Importe a confirmar por el profesional.",warning:"La cobertura se verifica directamente con el establecimiento."});
  }
  const r=validateRate(eligible[0]);
  if(r.status==="a_confirmar"||r.amountMinor===null){
    return Object.freeze({state:"contact",amountMinor:null,label:"Importe a confirmar por el profesional.",warning:"No se verificó la cobertura ni la autorización."});
  }
  return Object.freeze({
    state:"estimated",
    amountMinor:r.amountMinor,
    label:(kind==="particular"?"Precio particular de referencia: ":"Importe orientativo según convenio: ")+formatARS(r.amountMinor),
    warning:kind==="particular"
      ?"El establecimiento debe confirmar el importe al otorgar el turno."
      :"Sujeto a verificación de afiliación, plan, prestación y autorización. No garantiza cobertura ni es un cobro."
  });
}
export function availableServices(tenant){
  if(!tenant||!isId(tenant.tenantId)||!PROFILES.includes(tenant.profile))throw Error("Establecimiento inválido");
  const services=Array.isArray(tenant.services)?tenant.services:[];
  return services.filter(s=>s.tenantId===tenant.tenantId&&s.active===true&&isId(s.id)&&typeof s.name==="string"&&s.name.trim()&&
    Number.isInteger(s.durationMin)&&s.durationMin>=15&&s.durationMin<=720&&s.durationMin%15===0);
}
