// CITHELA · USA Taxes / Utah: purely administrative, in-memory preview.
// No taxpayer identity, tax values, document-status flags, uploads, API or persistence.
import { TAX_WORKFLOW_STAGES, safeServiceCatalog, UTAH_TENANT_DEFAULTS } from './utah-services.mjs';

export const TAX_YEAR = 2026;
export const DEMO_YEAR = 2027;
const TAX_SERVICE_IDS = new Set(safeServiceCatalog()
  .filter(service => service.category === 'tax').map(service => service.id));
const STAGES = TAX_WORKFLOW_STAGES.map(s => s.key);
const ALLOWED_ROLES = new Set(['owner','admin','operator']);
const ALLOWED_FIELDS = new Set(['caseId','serviceId','appointmentAt','role','now']);
const STAGE_ES = Object.freeze({
  contacted: 'Contactado',
  scheduled: 'Turno agendado',
  documents_pending: 'Preparación pendiente',
  ready_for_preparer: 'Listo para la cita',
  completed: 'Finalizado'
});
const LABELS = Object.freeze({
  en: {
    title: 'USA Taxes · 2026 returns',
    subtitle: 'Administrative appointment tracking · Salt Lake City, Utah',
    noFiles: 'No tax files, tax amounts or taxpayer details are collected.',
    empty: 'There are no sample appointments in this view.',
    guide: 'General preparation guide',
    overview: 'Appointment tracking',
    share: 'Mark general guide as shared',
    next: 'Move to next stage',
    done: 'The administrative workflow is finished.',
    note: 'Bring applicable documents to your appointment. Do not send tax records or personal information by text.',
    neutralMessage: 'Hello. This is a reminder about your appointment. Please bring any documents requested by your professional. Do not send personal or financial information by text message.',
    docHeading: 'Documents to consider bringing',
    disclaimer: 'Informational checklist only. Your professional will confirm what applies. Do not upload or send documents to CITHELA.'
  },
  es: {
    title: 'USA Taxes · declaraciones 2026',
    subtitle: 'Seguimiento administrativo de turnos · Salt Lake City, Utah',
    noFiles: 'No se recopilan documentos, importes ni datos fiscales personales.',
    empty: 'No hay turnos de ejemplo en esta vista.',
    guide: 'Guía general de preparación',
    overview: 'Seguimiento de turnos',
    share: 'Marcar guía general como compartida',
    next: 'Pasar a la siguiente etapa',
    done: 'El seguimiento administrativo está finalizado.',
    note: 'Llevá los documentos aplicables a la cita. No envíes registros fiscales ni datos personales por SMS.',
    neutralMessage: 'Hola. Te recordamos tu turno. Traé los documentos solicitados por el profesional. No envíes información personal o financiera por mensaje de texto.',
    docHeading: 'Documentos que podrían corresponder',
    disclaimer: 'Lista informativa. El profesional confirmará qué corresponde. No subas ni envíes documentos a CITHELA.'
  }
});
const fail = code => { const e=new Error(code); e.code=code; throw e; };
const localeCode = v => (v==='es' || v==='es-AR')?'es':'en';

export function getTaxLabels(locale='en') {
  const code=localeCode(locale);
  return {...LABELS[code], stages: TAX_WORKFLOW_STAGES.map(s=>({
    key:s.key, label:code==='es'?STAGE_ES[s.key]:s.label
  }))};
}

export function createDemoTaxCase(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) fail('invalid_payload');
  for(const key of Object.keys(input)) if(!ALLOWED_FIELDS.has(key)) fail('unapproved_field');
  if(!ALLOWED_ROLES.has(input.role)) fail('forbidden');
  if(typeof input.caseId!=='string' || !/^demo-[a-z0-9-]{1,30}$/.test(input.caseId)) fail('invalid_case_id');
  if(!TAX_SERVICE_IDS.has(input.serviceId)) fail('invalid_service');
  const at=Date.parse(input.appointmentAt);
  const now=Date.parse(input.now);
  if(typeof input.appointmentAt!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input.appointmentAt) || !Number.isFinite(at) || !Number.isFinite(now)) fail('invalid_date');
  if(new Date(input.appointmentAt).getUTCFullYear()!==DEMO_YEAR) fail('invalid_pilot_year');
  // Service references are existing Utah pilot presets. Never store a person ID here.
  return {
    caseId:input.caseId,
    serviceId:input.serviceId,
    appointmentAt:new Date(at).toISOString(),
    stage:'contacted',
    guideShared:false,
    revision:1
  };
}

export function advanceDemoTaxCase(taxCase, {role,expectedRevision}) {
  if(!ALLOWED_ROLES.has(role)) fail('forbidden');
  if(!Number.isInteger(expectedRevision) || taxCase.revision!==expectedRevision) fail('stale_write');
  const pos=STAGES.indexOf(taxCase.stage);
  if(pos<0) fail('invalid_stage');
  if(pos===STAGES.length-1) fail('already_completed');
  return {...taxCase, stage:STAGES[pos+1], revision:taxCase.revision+1};
}

export function markGeneralGuideShared(taxCase,{role,expectedRevision}) {
  if(!ALLOWED_ROLES.has(role)) fail('forbidden');
  if(taxCase.revision!==expectedRevision) fail('stale_write');
  if(taxCase.guideShared) return {case:taxCase,replayed:true};
  return {case:{...taxCase,guideShared:true,revision:taxCase.revision+1},replayed:false};
}

export function getTaxOverview(cases) {
  if(!Array.isArray(cases)) fail('invalid_cases');
  return {
    total:cases.length,
    active:cases.filter(c=>c.stage!=='completed').length,
    ready:cases.filter(c=>c.stage==='ready_for_preparer').length,
    pending:cases.filter(c=>c.stage==='documents_pending').length,
    finished:cases.filter(c=>c.stage==='completed').length
  };
}
export function getPublicPreparationGuide({serviceId,locale='en'}) {
  if(!TAX_SERVICE_IDS.has(serviceId)) fail('invalid_service');
  // Only generic topics; never request responses about the person's documents.
  const categories = localeCode(locale)==='es' ? [
    'Identificación: llevarla en persona, no enviarla por SMS.',
    'Comprobantes de ingresos que correspondan (por ejemplo, W-2 o 1099).',
    'Otros documentos aplicables, por ejemplo 1095-A o 1098.',
    'Declaración del año anterior, si está disponible.',
    'Preguntas para conversar con el profesional durante la cita.'
  ] : [
    'Photo identification: bring it in person, not by text.',
    'Applicable income statements, for example W-2 or 1099.',
    'Other applicable documents, such as 1095-A or 1098.',
    'Prior-year tax return, if available.',
    'Questions to discuss with your professional during the appointment.'
  ];
  const labels=getTaxLabels(locale);
  return {taxYear:TAX_YEAR, serviceId, title:labels.docHeading,
    items:categories,disclaimer:labels.disclaimer, collectionEnabled:false};
}
export function neutralAppointmentMessage(locale='en') {
  return getTaxLabels(locale).neutralMessage;
}
export function formatUtahAppointment(iso,locale='en') {
  if(!Number.isFinite(Date.parse(iso))) fail('invalid_date');
  return new Intl.DateTimeFormat(localeCode(locale)==='es'?'es-AR':'en-US',{
    dateStyle:'medium',timeStyle:'short',timeZone:UTAH_TENANT_DEFAULTS.timeZone
  }).format(new Date(iso));
}
