// Policy model for future US A2P SMS integration.
// NOT a transport: no fetch, no credentials, no messaging enabled by this code.
import {cleanE164,validateAccessUrl} from "./sms.mjs";
export const AUTOMATED_SMS_DEFAULT_ENABLED=false;
const OPT_OUT=new Set(["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT"]);
export function classifyInboundKeyword(body){
  const word=String(body??"").trim().toUpperCase().replace(/[.!]+$/,"");
  if(OPT_OUT.has(word))return "opt_out";
  if(word==="HELP")return "help";
  if(word==="START"||word==="UNSTOP")return "opt_in_request";
  return "ordinary";
}
export function evaluateAutomatedSms({
  tenantEnabled=false,providerApproved=false,registeredSender=false,
  recipientPhone,consent,blocklisted=false,dailyRemaining=0,
  templateKey,portalUrl,region="US"
}={}){
  // No provider enabled means no automatic SMS. This must be checked server-side.
  if(!tenantEnabled)return {ok:false,reason:"tenant_disabled"};
  if(!providerApproved||!registeredSender)return {ok:false,reason:"sender_unregistered"};
  if(region!=="US")return {ok:false,reason:"unsupported_region"};
  let number;try{number=cleanE164(recipientPhone);}catch{return {ok:false,reason:"invalid_recipient"};}
  if(!number.startsWith("+1"))return {ok:false,reason:"non_us_number"};
  if(blocklisted)return {ok:false,reason:"opted_out"};
  if(consent?.channel!=="sms"||consent?.phone!==number||
     typeof consent?.recordedAt!=="string"||!Number.isFinite(Date.parse(consent.recordedAt))||
     !consent?.evidenceReference)return {ok:false,reason:"consent_missing"};
  if(!Number.isInteger(dailyRemaining)||dailyRemaining<=0)return {ok:false,reason:"daily_limit"};
  if(!["booking_access","appointment_reminder"].includes(templateKey))
    return {ok:false,reason:"unapproved_template"};
  try{validateAccessUrl(portalUrl);}catch{return {ok:false,reason:"invalid_url"};}
  return {ok:true,reason:"eligible_for_server_review",recipient:number};
}
