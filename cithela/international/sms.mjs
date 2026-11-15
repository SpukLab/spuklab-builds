// CITHELA SMS composer: manual, no provider API or automatic transmission.
// Never use an SMS draft to send a phone-OTP invite: existing phone OTP is WhatsApp-only.
import {t,normalizeLocale} from "./locale.mjs";
export const CITHELA_ORIGIN="https://spuklab.github.io";
export const CITHELA_PATH="/spuklab-builds/cithela/";
export function cleanE164(input){
  const value=String(input||"").trim().replace(/[\s().-]/g,"");
  if(!/^\+[1-9][0-9]{7,14}$/.test(value))throw new RangeError("Invalid E.164 phone number");
  return value;
}
export function validateAccessUrl(input){
  let u;
  try{u=new URL(String(input||""));}catch{throw new RangeError("Invalid booking URL");}
  if(u.protocol!=="https:"||u.origin!==CITHELA_ORIGIN||
    !(u.pathname===CITHELA_PATH||u.pathname===CITHELA_PATH+"index.html")||
    u.username||u.password)throw new RangeError("Untrusted booking URL");
  return u;
}
export function appendAccessLocale(input,locale){
  const u=validateAccessUrl(input);
  u.searchParams.set("lang",normalizeLocale(locale)==="en-US"?"en":"es");
  return u.toString();
}
export function createSmsDraft({
  phone,clinic,locale="es-AR",accessUrl=CITHELA_ORIGIN+CITHELA_PATH,
  purpose="access",consent=false
}={}){
  if(consent!==true)throw new Error("Recipient consent not confirmed");
  const to=cleanE164(phone);
  const cleanClinic=String(clinic||"CITHELA").replace(/[\x00-\x1f\x7f]/g," ").trim().slice(0,65)||"CITHELA";
  const u=validateAccessUrl(accessUrl);
  if(purpose==="invitation"&&!(u.hash.startsWith("#invite=")))
    throw new RangeError("Personal invitation link missing");
  if(purpose!=="invitation"&&purpose!=="access")throw new RangeError("Unsupported SMS purpose");
  const message=t(purpose==="invitation"?"smsInvite":"smsNeutralAccess",locale,{
    clinic:cleanClinic,url:appendAccessLocale(u.toString(),locale)
  });
  // RFC 5724: sms:+E164?body=<UTF8 percent encoded>. Opens device app for human review.
  return Object.freeze({to,message,uri:"sms:"+to+"?body="+encodeURIComponent(message),
    purpose,automatic:false,provider:null});
}
export function smsSegments(message){
  const str=String(message||"");
  // Estimate, not a carrier invoice: Latin GSM-7 excludes several extended characters.
  const isSimple=/^[\x0A\x0D\x20-\x7E]*$/.test(str);
  const count=Array.from(str).length;
  const limit=isSimple?(count<=160?160:153):(count<=70?70:67);
  return {encoding:isSimple?"GSM-7 (basic estimate)":"Unicode (estimate)",
    segments:Math.max(1,Math.ceil(count/limit)),characters:count};
}
