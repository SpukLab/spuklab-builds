// Local SMS composer. No network requests, credentials, automation or inbound webhook.
// The patient must already have an account to access the general appointment portal.
import {t,selectLocale,LOCALE_KEY} from "./locale.mjs";
import {createSmsDraft,smsSegments} from "./sms.mjs";
function locale(){
  return window.CithelaLocale?.get()||selectLocale({
    search:location.search,stored:(()=>{try{return localStorage.getItem(LOCALE_KEY);}catch{return "";}})(),
    browser:navigator.language
  });
}
const el=document.createElement("dialog");
el.id="cithela-sms-dialog";
el.setAttribute("aria-labelledby","cithela-sms-title");
el.style.cssText="border:1px solid var(--border-color,#dce8e3);border-radius:14px;background:#fff;color:#243733;max-width:520px;width:calc(100vw - 24px);padding:20px;box-shadow:0 18px 45px #24373333;font:14px/1.45 'DM Sans',sans-serif;";
el.innerHTML=`
  <h2 id="cithela-sms-title" style="margin:0 0 12px;font-size:1.25rem"></h2>
  <p id="cithela-sms-intro" style="margin:0 0 9px;font-size:.84rem;color:#536961"></p>
  <p id="cithela-sms-recipient" style="font-weight:700;margin:0 0 9px"></p>
  <textarea id="cithela-sms-body" readonly rows="6"
    style="font:inherit;display:block;resize:vertical;width:100%;border:1px solid #dce8e3;border-radius:9px;padding:12px;min-height:118px"></textarea>
  <p id="cithela-sms-segments" style="font-size:12px;color:#536961;margin:9px 0"></p>
  <p id="cithela-sms-risk" style="font-size:12px;color:#795b27;margin:9px 0"></p>
  <label style="display:flex;align-items:flex-start;gap:9px;font-size:13px;line-height:1.45;margin:15px 0">
    <input id="cithela-sms-consent" type="checkbox" style="width:20px;height:20px;flex-shrink:0">
    <span id="cithela-sms-consent-label"></span>
  </label>
  <p id="cithela-sms-error" role="status" style="font-size:13px;color:#923b48;min-height:18px"></p>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button id="cithela-sms-send" type="button" class="btn-main" style="flex:1;min-height:44px"></button>
    <button id="cithela-sms-copy" type="button" class="btn-main soft" style="flex:1;min-height:44px"></button>
    <button id="cithela-sms-close" type="button" class="btn-main ghost" style="flex:1;min-height:44px"></button>
  </div>
  <p id="cithela-sms-auto" style="font-size:12px;color:#536961;margin:10px 0 0"></p>
`;
document.body.append(el);
let data=null;
const $=id=>document.getElementById(id);
function render(){
  const lang=locale();
  $("cithela-sms-title").textContent=t(data?.purpose==="invitation"?"smsInviteAccess":"smsAccess",lang);
  $("cithela-sms-intro").textContent=t("smsIntro",lang);
  $("cithela-sms-consent-label").textContent=t("smsConsent",lang);
  $("cithela-sms-risk").textContent=t("smsNoPrivate",lang);
  $("cithela-sms-send").textContent=t("smsOpen",lang);
  $("cithela-sms-copy").textContent=t("smsCopy",lang);
  $("cithela-sms-close").textContent=t("smsClose",lang);
  $("cithela-sms-auto").textContent=t("smsNoAuto",lang);
  if(data){
    $("cithela-sms-recipient").textContent=t("smsRecipient",lang)+": "+data.phone;
    $("cithela-sms-body").value=draft(true).message;
    const stats=smsSegments($("cithela-sms-body").value);
    $("cithela-sms-segments").textContent=stats.characters+" chars · approx. "+stats.segments+" SMS segments";
  }
}
function draft(consent){
  return createSmsDraft({...data,locale:locale(),consent});
}
function openForPerson({phone,clinic,accessUrl,purpose="access"}={}){
  // Validation before displaying dialog; no openUri until a separate click.
  try{
    data={phone,clinic,accessUrl,purpose};
    draft(true);
    $("cithela-sms-consent").checked=false;
    $("cithela-sms-error").textContent="";
    render();
    el.showModal();
    return true;
  }catch{
    data=null;
    alert(t("smsMissingPhone",locale()));
    return false;
  }
}
function requireConsent(){
  if(!$("cithela-sms-consent").checked){
    $("cithela-sms-error").textContent=t("smsMissingConsent",locale());
    return false;
  }
  return true;
}
$("cithela-sms-close").addEventListener("click",()=>el.close());
$("cithela-sms-consent").addEventListener("change",()=>$("cithela-sms-error").textContent="");
$("cithela-sms-send").addEventListener("click",()=>{
  if(!data||!requireConsent())return;
  const result=draft(true);
  // On desktop some environments cannot open sms: links; the copy button remains available.
  window.location.assign(result.uri);
});
$("cithela-sms-copy").addEventListener("click",async()=>{
  if(!data||!requireConsent())return;
  try{
    await navigator.clipboard.writeText(draft(true).message);
    $("cithela-sms-error").textContent=t("smsCopied",locale());
  }catch{
    $("cithela-sms-body").focus();$("cithela-sms-body").select();
    $("cithela-sms-error").textContent=t("smsCannotOpen",locale());
  }
});
document.addEventListener("cithela-locale-changed",()=>{if(el.open)render();});
window.CithelaSMS=Object.freeze({openForPerson});
