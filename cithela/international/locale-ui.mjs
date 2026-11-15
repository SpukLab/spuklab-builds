// Progressive localization: use explicit selectors, never translate patient-provided data.
// Completeness is tracked in international/README.md; complex generated screens remain ES in v1.
import {LOCALE_KEY,selectLocale,normalizeLocale,t} from "./locale.mjs";
const fixed=[
 ["#rb-med","professional"],["#rb-pac","patient"],
 ["#professional-login-button","login"],["#professional-login-fields label[for='l-cloud-email']","professionalEmail"],
 ["#professional-login-fields label[for='l-cloud-password']","password"],
 ["#professional-login-fields button[onclick='requestProfessionalPasswordReset()']","forgotPassword"],
 ["#screen-medico .nav-out","signOut"],["#screen-patient-cloud .nav-out","signOut"],
 ["#medico-tab-agenda","agenda"],["#medico-tab-personas","patients"],
 ["#medico-tab-nuevo","newAppointment"],["#medico-tab-config","settings"],
 ["#screen-patient-cloud .nav-brand .nb2","appointments"],
 ["#screen-patient-cloud .patient-portal-content h2","appointments"],
 ["#screen-patient-cloud .patient-refresh","refreshAppointments"],
 ["#screen-patient-cloud nav .pill","patientCloud"],
 ["#cithela-first-steps-title","firstSteps"],
 ["#cithela-first-steps .cithela-first-steps__eyebrow","firstStepsTag"],
 ["#cfg-section-hours>summary","businessHours"],
 ["#cfg-section-availability>summary","availability"],
 ["#p-medico-config .settings-group-title","scheduleAndCare"]
];
// Most navigation buttons contain SVG; adjust text nodes without replacing icons.
function setLabel(el,next){
  if(!el)return;
  const textNodes=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.nodeValue.trim());
  if(textNodes.length){
    const last=textNodes.at(-1);
    if(last.nodeValue.trim()!==next)last.nodeValue=next;
    return;
  }
  if(!el.children.length&&el.textContent!==next)el.textContent=next;
}
// Patient booking controls are created with innerHTML after cloud refreshes.
// Only translate known UI strings inside the authenticated patient workspace.
// Never rewrite tenant names, appointment details, service names or patient notes.
const patientUiPairs=[
 ["Reservar nuevo turno","Book an appointment"],["Cerrar nueva reserva","Close booking"],
 ["Confirmar turno","Confirm appointment"],["Reprogramar","Reschedule"],
 ["Cancelar turno","Cancel appointment"],["Cerrar","Close"],
 ["Servicio","Service"],["Profesional","Professional"],["Fecha","Date"],
 ["Nueva fecha","New date"],["Motivo (opcional)","Reason (optional)"],
 ["Horarios disponibles · mínimo 2 horas de anticipación","Available times · at least 2 hours ahead"],
 ["Elegí un horario.","Select a time."],["Seleccioná un horario disponible.","Choose an available time."],
 ["Buscando horarios cloud…","Finding available times…"],
 ["Cargando servicios y profesionales…","Loading services and professionals…"],
 ["Consultando horarios disponibles…","Loading available times…"],
 ["No hay horarios libres para esta fecha.","No available times on this date."],
 ["Sin turnos próximos.","No upcoming appointments."],
 ["Todavía no hay turnos anteriores.","No previous appointments."],
 ["Establecimiento donde reservás","Your healthcare provider"],
 ["Pendiente","Pending"],["Confirmado","Confirmed"],
 ["Cancelado","Cancelled"],["Atendido","Completed"],
 ["No asistió","Missed"],["Reservar nuevo turno","Book an appointment"]
];
function patientUiTranslate(target){
  const scope=document.querySelector("#patient-cloud-list");
  if(!scope)return;
  const dictionary=new Map(patientUiPairs.map(([es,en])=>
    target==="en-US"?[es,en]:[en,es]));
  scope.querySelectorAll(".patient-workspace button,.patient-workspace label,.patient-workspace p,.patient-workspace summary,.patient-workspace .tag")
    .forEach(el=>{
      if(el.closest(".patient-shared-panel")||el.classList.contains("tenant-business-title")||
         el.classList.contains("tenant-card-person")||el.children.length>0)return;
      const current=el.textContent.trim();
      const next=dictionary.get(current);
      if(next&&next!==current)el.textContent=next;
      // Counted titles: translate prefix only, preserving the count.
      else if(el.classList.contains("sh")){
        const m=current.match(/^(Próximos|Historial|Upcoming|History) \((\d+)\)$/);
        if(m){
          const word=target==="en-US"?(m[1]==="Próximos"?"Upcoming":"History"):
            (m[1]==="Upcoming"?"Próximos":"Historial");
          const label=word+" ("+m[2]+")";
          if(current!==label)el.textContent=label;
        }
      }
    });
  const reason=document.getElementById("patient-book-reason");
  if(reason){
    const ph=target==="en-US"?"Briefly describe your request":"Comentá brevemente el motivo";
    if(reason.placeholder!==ph)reason.placeholder=ph;
  }
}
let locale="es-AR",queued=false;
export function applyLocale(next=locale){
  locale=normalizeLocale(next);
  document.documentElement.lang=locale==="en-US"?"en":"es";
  for(const [selector,key] of fixed){
    const el=document.querySelector(selector);
    if(el)setLabel(el,t(key,locale));
  }
  patientUiTranslate(locale);
  document.querySelectorAll("[data-cithela-language]").forEach(btn=>{
    const chosen=normalizeLocale(btn.dataset.cithelaLanguage)===locale;
    btn.setAttribute("aria-pressed",String(chosen));
    btn.classList.toggle("is-selected",chosen);
    btn.title=t("language",locale);
  });
  document.querySelectorAll("[data-cithela-i18n]").forEach(el=>{
    setLabel(el,t(el.dataset.cithelaI18n,locale));
  });
  document.querySelectorAll("[data-cithela-language-chooser]").forEach(el=>{
    el.setAttribute("aria-label",t("language",locale));
  });
  // Global locale for optional modules; not used as an authentication signal.
  window.CithelaLocale={get:()=>locale,t:(key,vars)=>t(key,locale,vars)};
  document.dispatchEvent(new CustomEvent("cithela-locale-changed",{detail:{locale}}));
}
export function setLocale(next){
  locale=normalizeLocale(next);
  try{localStorage.setItem(LOCALE_KEY,locale);}catch{}
  const url=new URL(window.location.href);
  url.searchParams.set("lang",locale==="en-US"?"en":"es");
  history.replaceState(history.state,"",url);
  applyLocale();
}
document.addEventListener("click",e=>{
  const target=e.target.closest("[data-cithela-language]");
  if(target)setLocale(target.dataset.cithelaLanguage);
});
try{locale=selectLocale({
  search:location.search,
  stored:localStorage.getItem(LOCALE_KEY)||"",
  browser:navigator.language
});}catch{locale=selectLocale({search:location.search,browser:navigator.language});}
applyLocale(locale);
const observer=new MutationObserver(()=>{
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;applyLocale();});
});
for(const id of ["screen-login","screen-medico","screen-patient-cloud"]){
  const el=document.getElementById(id);
  if(el)observer.observe(el,{subtree:true,childList:true});
}
