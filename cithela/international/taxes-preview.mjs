import { safeServiceCatalog } from './utah-services.mjs';
import {
  createDemoTaxCase,advanceDemoTaxCase,markGeneralGuideShared,
  getTaxOverview,getTaxLabels,getPublicPreparationGuide,
  neutralAppointmentMessage,formatUtahAppointment
} from './taxes-workflow.mjs';

// CITHELA Utah: all identifiers and dates below are artificial.
// This page uses memory only. No API, sessions, storage, SMS or taxpayer data.
const serviceCatalog=safeServiceCatalog().filter(item=>item.category==='tax');
const $=id=>document.getElementById(id);
const el=(tag,content,cls)=>{
  const node=document.createElement(tag);
  if(content!==undefined&&content!==null)node.textContent=String(content);
  if(cls)node.className=cls;
  return node;
};
const now='2026-11-23T15:00:00Z';
const seed=(caseId,serviceId,appointmentAt,position)=>{
  let item=createDemoTaxCase({caseId,serviceId,appointmentAt,now,role:'admin'});
  for(let i=0;i<position;i++)item=advanceDemoTaxCase(item,{role:'admin',expectedRevision:item.revision});
  return item;
};
let cases=[
  seed('demo-a','tax-2026','2027-01-13T17:00:00Z',0),
  seed('demo-b','tax-document-review','2027-01-20T19:00:00Z',2),
  seed('demo-c','tax-credit-consult','2027-02-04T18:30:00Z',3)
];
let selectedId=cases[0].caseId;
const locale=()=>$('locale').value;
const selected=()=>cases.find(x=>x.caseId===selectedId);
const string=(key)=>({
  en:{
    total:'Sample cases',active:'In progress',ready:'Ready for visit',finished:'Completed',
    list:'Appointments · examples',listInfo:'Fictitious references only: no client names, phone numbers or taxpayer records.',
    service:'Service',date:'Appointment · Utah local time',ref:'Sample reference',shared:'Preparation guide',
    no:'Not shared',yes:'Shared (demo)',reminder:'Neutral reminder · manual copy only',
    copy:'Copy neutral text',copySuccess:'Copied to clipboard (not sent).',
    copyFailure:'Copy was blocked. Select the neutral text to copy manually.',
    saved:'Demo status updated in memory. Reload to reset.',
    already:'This case is already completed.',sharedDone:'Guide marked shared in memory only.',
    guide:'General preparation guide'
  },
  es:{
    total:'Casos ficticios',active:'En seguimiento',ready:'Listos para cita',finished:'Finalizados',
    list:'Turnos · ejemplos',listInfo:'Referencias ficticias: sin nombres, teléfonos ni documentos de contribuyentes.',
    service:'Servicio',date:'Turno · hora local Utah',ref:'Referencia de prueba',shared:'Guía de preparación',
    no:'No compartida',yes:'Compartida (demo)',reminder:'Recordatorio neutro · copia manual',
    copy:'Copiar texto neutro',copySuccess:'Copiado al portapapeles (no enviado).',
    copyFailure:'No se pudo copiar. Seleccioná manualmente el texto del mensaje.',
    saved:'Estado de demostración actualizado en memoria. Recargá para reiniciar.',
    already:'El seguimiento de este caso ya está finalizado.',sharedDone:'Guía marcada como compartida, solo en memoria.',
    guide:'Guía general de preparación'
  }
})[locale()][key];

function setText(id,value){$(id).textContent=value;}
function renderStats(){
  const summary=getTaxOverview(cases);
  for(const key of ['total','active','ready','finished']){
    setText('metric-'+key,summary[key]);
    setText('label-'+key,string(key));
  }
}
function serviceLabel(item){
  const service=serviceCatalog.find(s=>s.id===item.serviceId);
  if(!service)return '—';
  return locale()==='es'?service.nameEs:service.name;
}
function renderCaseList(){
  const list=$('case-list');
  list.replaceChildren();
  const stages=getTaxLabels(locale()).stages;
  for(const taxCase of cases){
    const button=el('button',null,'case');
    button.type='button';
    button.setAttribute('aria-pressed',String(taxCase.caseId===selectedId));
    button.append(el('strong',serviceLabel(taxCase)));
    button.append(el('span',taxCase.caseId.toUpperCase()+' · '+formatUtahAppointment(taxCase.appointmentAt,locale())));
    button.append(el('span',stages.find(s=>s.key===taxCase.stage)?.label||'—'));
    button.addEventListener('click',()=>{selectedId=taxCase.caseId;renderAll();});
    list.append(button);
  }
}
function renderStageSteps(taxCase){
  const stages=getTaxLabels(locale()).stages;
  const steps=$('stage-steps');
  steps.replaceChildren();
  const current=stages.findIndex(s=>s.key===taxCase.stage);
  for(let i=0;i<stages.length;i++){
    const step=el('span',stages[i].label,'step'+(i===current?' active':''));
    if(i===current)step.setAttribute('aria-current','step');
    steps.append(step);
  }
}
function renderSelected(){
  const item=selected();
  const labels=getTaxLabels(locale());
  setText('case-heading',labels.overview);
  setText('case-status',labels.stages.find(x=>x.key===item.stage)?.label||'—');
  setText('case-service',serviceLabel(item));
  setText('case-date',formatUtahAppointment(item.appointmentAt,locale()));
  setText('case-ref',item.caseId.toUpperCase());
  setText('guide-state',item.guideShared?string('yes'):string('no'));
  setText('label-service',string('service'));
  setText('label-date',string('date'));
  setText('label-reference',string('ref'));
  setText('label-shared',string('shared'));
  setText('advance',labels.next);
  $('advance').disabled=item.stage==='completed';
  setText('mark-shared',labels.share);
  $('mark-shared').disabled=item.guideShared;
  renderStageSteps(item);
  const guide=getPublicPreparationGuide({serviceId:item.serviceId,locale:locale()});
  setText('guide-heading',guide.title);
  setText('guide-warning',labels.note);
  setText('guide-disclaimer',guide.disclaimer);
  const items=$('guide-items');
  items.replaceChildren();
  for(const value of guide.items)items.append(el('li',value));
  setText('reminder-heading',string('reminder'));
  setText('reminder',neutralAppointmentMessage(locale()));
  setText('copy-message',string('copy'));
}
function renderAll(){
  const labels=getTaxLabels(locale());
  document.documentElement.lang=locale();
  setText('heading',labels.title);
  setText('subtitle',labels.subtitle);
  setText('privacy',labels.noFiles);
  setText('cases-heading',string('list'));
  setText('case-list-info',string('listInfo'));
  renderStats();renderCaseList();renderSelected();
}
$('locale').addEventListener('change',()=>{
  setText('status','');setText('copy-result','');renderAll();
});
$('advance').addEventListener('click',()=>{
  const item=selected();
  try{
    const updated=advanceDemoTaxCase(item,{role:'admin',expectedRevision:item.revision});
    cases=cases.map(c=>c.caseId===updated.caseId?updated:c);
    renderAll();setText('status',string('saved'));
  }catch(error){
    setText('status',error.code==='already_completed'?string('already'):error.code);
  }
});
$('mark-shared').addEventListener('click',()=>{
  const item=selected();
  try{
    const result=markGeneralGuideShared(item,{role:'admin',expectedRevision:item.revision});
    cases=cases.map(c=>c.caseId===item.caseId?result.case:c);
    renderAll();setText('status',string('sharedDone'));
  }catch(error){setText('status',error.code);}
});
$('copy-message').addEventListener('click',async()=>{
  // Host SMS integration is intentionally NOT present.
  const content=neutralAppointmentMessage(locale());
  try{
    if(!navigator.clipboard?.writeText)throw Error('clipboard_unavailable');
    await navigator.clipboard.writeText(content);
    setText('copy-result',string('copySuccess'));
  }catch{setText('copy-result',string('copyFailure'));}
});
renderAll();