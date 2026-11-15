// CITHELA internationalization foundation (es-AR / en-US).
// Existing Spanish strings remain the default; no booking or authentication behavior changes.
export const LOCALE_KEY="cithela_ui_locale_v1";
export const DEFAULT_LOCALE="es-AR";
export const SUPPORTED_LOCALES=Object.freeze(["es-AR","en-US"]);
export function normalizeLocale(input){
  const value=String(input||"").trim().replace("_","-").toLowerCase();
  if(value==="en"||value.startsWith("en-"))return "en-US";
  return "es-AR";
}
export function selectLocale({search="",stored="",browser=""}={}){
  const choice=new URLSearchParams(String(search).replace(/^\?/,"")).get("lang");
  if(choice&&/^(es|es-ar|en|en-us)$/i.test(choice))return normalizeLocale(choice);
  if(stored&&/^(es|es-ar|en|en-us)$/i.test(stored))return normalizeLocale(stored);
  return normalizeLocale(browser);
}
const DICT={
  "es-AR":{
    professional:"Profesional",patient:"Paciente",login:"Ingresar",settings:"Ajustes",
    appointments:"Mis turnos",agenda:"Agenda",patients:"Pacientes",newAppointment:"+ Turno",
    signOut:"Salir",professionalEmail:"Correo profesional",password:"Contraseña",
    forgotPassword:"Olvidé mi contraseña",patientCloud:"Paciente · Nube",
    newBooking:"Reservar nuevo turno",refreshAppointments:"Actualizar mis turnos",
    businessHours:"Horarios de atención",availability:"Ausencias y bloqueos",
    scheduleAndCare:"Agenda y atención",firstSteps:"Prepará tu espacio",
    firstStepsTag:"PRIMEROS PASOS · AGENDA CLOUD",
    contacts:"Primera persona",hours:"Días y horarios",servicesDuration:"Servicios y duración",
    sms:"Mensaje de texto (SMS)",smsPreview:"Preparar SMS",smsCopy:"Copiar mensaje",
    smsOpen:"Abrir mensajes",smsClose:"Cerrar",smsRecipient:"Destinatario",
    smsConsent:"Confirmo que la persona aceptó recibir este mensaje.",
    smsIntro:"Revisá el destinatario y el texto antes de abrir la aplicación de mensajes.",
    smsNoAuto:"CITHELA no enviará el SMS automáticamente.",
    smsNoPrivate:"No incluyas información médica o sensible en el SMS.",
    smsMissingPhone:"Este paciente no tiene un teléfono internacional válido.",
    smsMissingConsent:"Confirmá el consentimiento antes de preparar el SMS.",
    smsCopied:"Mensaje copiado.",smsCannotOpen:"Copiá el texto y enviá el SMS desde tu teléfono.",
    smsNeutralAccess:"{clinic}: Accedé a tus turnos desde {url}. Ingresá con tu cuenta. Para consultas, comunicate con el establecimiento.",
    smsInvite:"{clinic}: Recibiste un acceso a CITHELA. Abrí tu enlace personal: {url}. No compartas este enlace.",
    smsAccess:"Acceso a turnos",smsInviteAccess:"Invitación de acceso",
    language:"Idioma",languageEnglish:"Inglés",languageSpanish:"Español",
    englishPreview:"Traducción inicial: algunas secciones aún no están disponibles en inglés."
  },
  "en-US":{
    professional:"Professional",patient:"Patient",login:"Sign in",settings:"Settings",
    appointments:"My appointments",agenda:"Schedule",patients:"Patients",newAppointment:"+ Appointment",
    signOut:"Sign out",professionalEmail:"Professional email",password:"Password",
    forgotPassword:"Forgot password?",patientCloud:"Patient · Cloud",
    newBooking:"Book an appointment",refreshAppointments:"Refresh my appointments",
    businessHours:"Business hours",availability:"Time off & blocked slots",
    scheduleAndCare:"Schedule & services",firstSteps:"Set up your practice",
    firstStepsTag:"GET STARTED · CLOUD SCHEDULING",
    contacts:"First patient",hours:"Days and hours",servicesDuration:"Services and duration",
    sms:"Text message (SMS)",smsPreview:"Prepare text",smsCopy:"Copy message",
    smsOpen:"Open Messages",smsClose:"Close",smsRecipient:"Recipient",
    smsConsent:"I confirm the patient agreed to receive this message.",
    smsIntro:"Check the recipient and message before opening your messaging app.",
    smsNoAuto:"CITHELA will not send the text automatically.",
    smsNoPrivate:"Do not include diagnoses or other sensitive health information in a text.",
    smsMissingPhone:"This patient does not have a valid international phone number.",
    smsMissingConsent:"Confirm consent before preparing the text message.",
    smsCopied:"Message copied.",smsCannotOpen:"Copy the message and send it using your phone.",
    smsNeutralAccess:"{clinic}: Access your appointments at {url}. Sign in with your account. Contact the practice if you need help.",
    smsInvite:"{clinic}: Your CITHELA access link is {url}. This link is personal. Please do not share it.",
    smsAccess:"Appointment access",smsInviteAccess:"Access invitation",
    language:"Language",languageEnglish:"English",languageSpanish:"Español",
    englishPreview:"English is in an initial preview. Some sections are not translated yet."
  }
};
export function t(key,locale=DEFAULT_LOCALE,variables={}){
  const dict=DICT[normalizeLocale(locale)];
  const template=dict[key]??DICT[DEFAULT_LOCALE][key]??String(key);
  return template.replace(/\{(\w+)\}/g,(_,name)=>String(variables[name]??""));
}
export function supportedTranslations(){return Object.keys(DICT["en-US"]);}
export function formatCithelaDate(value,locale=DEFAULT_LOCALE,timeZone="UTC"){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw new RangeError("Invalid date");
  return new Intl.DateTimeFormat(normalizeLocale(locale),{timeZone,year:"numeric",month:"short",day:"numeric"}).format(date);
}
