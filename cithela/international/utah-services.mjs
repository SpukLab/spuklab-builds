// CITHELA Utah pilot: service catalog and intake guidance ONLY.
// No tax return preparation, tax credit computation, underwriting, or storing PII.
export const UTAH_TENANT_DEFAULTS=Object.freeze({
  locale:"en-US",secondaryLocale:"es-AR",timeZone:"America/Denver",
  currency:"USD",phoneCountryCode:"+1",region:"UT",country:"US",
  smsMode:"manual",automatedSmsEnabled:false,
  taxDataCollectionEnabled:false
});
export const UTAH_SERVICE_PRESETS=Object.freeze([
  {id:"auto-quote",category:"insurance",name:"Auto Insurance Quote",
   nameEs:"Cotización de seguro de auto",durationMin:30,
   initialChecklist:["Current insurance company (if any)","Vehicle information","Questions for the agent"]},
  {id:"home-quote",category:"insurance",name:"Homeowners Insurance Quote",
   nameEs:"Cotización de seguro de vivienda",durationMin:40,
   initialChecklist:["Property information","Current policy details (if any)","Questions for the agent"]},
  {id:"policy-review",category:"insurance",name:"Insurance Policy Review",
   nameEs:"Revisión de póliza de seguro",durationMin:25,
   initialChecklist:["Existing policy details","Requested changes or renewal date"]},
  {id:"tax-2026",category:"tax",name:"2026 Individual Tax Return — Intake",
   nameEs:"Declaración de impuestos 2026 — entrevista",durationMin:50,
   initialChecklist:["Photo ID and taxpayer identity verification","2026 W-2 statements from all employers",
    "Applicable 1099 income statements","Prior year's tax return (if available)",
    "Questions on dependents and potential credits"]},
  {id:"tax-document-review",category:"tax",name:"2026 Tax Documents Review",
   nameEs:"Revisión de documentación fiscal 2026",durationMin:25,
   initialChecklist:["Available W-2 and 1099 statements","1095-A if Marketplace coverage applies",
     "Other relevant 1098 statements","Outstanding documents"]},
  {id:"tax-credit-consult",category:"tax",name:"Tax Credits Eligibility Consultation",
   nameEs:"Consulta de elegibilidad a créditos fiscales",durationMin:40,
   initialChecklist:["Prior-year tax return, if available","Income statements","Dependent information",
     "Questions about EITC, CTC and other applicable credits"]}
]);
export function safeServiceCatalog(){
  return UTAH_SERVICE_PRESETS.map(service=>({
    id:service.id,category:service.category,name:service.name,
    nameEs:service.nameEs,durationMin:service.durationMin
  }));
}
export function serviceGuidance(serviceId){
  const preset=UTAH_SERVICE_PRESETS.find(x=>x.id===serviceId);
  if(!preset)throw new RangeError("Unknown Utah pilot service");
  return {title:preset.name,items:[...preset.initialChecklist],
    disclaimer:preset.category==="tax"
      ?"Bring documents to your appointment. Do not send SSNs, W-2 files or tax records via regular SMS."
      :"Bring relevant information to your appointment. Avoid sending sensitive information by SMS.",
    collectionEnabled:false};
}
export const TAX_WORKFLOW_STAGES=Object.freeze([
  {key:"contacted",label:"Contacted"},
  {key:"scheduled",label:"Appointment scheduled"},
  {key:"documents_pending",label:"Documents pending"},
  {key:"ready_for_preparer",label:"Ready for preparer"},
  {key:"completed",label:"Completed"}
]);
export function taxAppointmentWindow(year=2027){
  if(year!==2027)throw new RangeError("2026 tax season pilot only");
  return Object.freeze({
    taxYear:2026,serviceYear:2027,
    employerW2Due:"2027-02-01",utahIndividualReturnDue:"2027-04-15",
    timeZone:"America/Denver",
    irsSeasonStart:"not_announced"
  });
}
