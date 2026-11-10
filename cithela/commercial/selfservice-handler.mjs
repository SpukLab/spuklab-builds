const ORIGIN='https://spuklab.github.io';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(status,code,extra={})=>Response.json({ok:status===200,code,...extra},{status,headers});
async function readBody(req){
 const reader=req.body?.getReader();if(!reader)throw Error('invalid_json');
 const chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>3000){await reader.cancel();throw Error('request_too_large')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw Error('invalid_json')}
}
export async function handleSelfservice(req,ctx){
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,'method_not_allowed');
 if(req.headers.get('origin')!==ORIGIN)return reply(403,'origin_denied');
 let body;
 try{body=await readBody(req)}catch(e){return reply(e.message==='request_too_large'?413:400,e.message==='request_too_large'?'request_too_large':'invalid_json')}
 if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='action,payload'||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))return reply(400,'invalid_request');
 const {action,payload}=body;
 if(!['auth_config','status','admit','resume','read','configure','authorize_test','test_status'].includes(action))return reply(400,'invalid_action');
 if(action==='auth_config'){
  if(Object.keys(payload).length)return reply(400,'unexpected_fields');
  const sitekey=typeof ctx?.sitekey==='string'?ctx.sitekey:'';
  return reply(200,'auth_config',{required:ctx?.authCaptchaRequired===true,sitekey:sitekey||null});
 }
 if(!ctx?.ready||!UUID.test(ctx.adminId||'')||typeof ctx.execute!=='function')return reply(503,'admissions_closed');
 const administrative=['read','configure','authorize_test'].includes(action);
 if(action==='status'&&ctx.enabled!==true)return reply(503,'admissions_closed');
 if(['admit','test_status'].includes(action)&&ctx.enabled!==true&&ctx.testReady!==true)return reply(503,'admissions_closed');
 let user;
 if(action!=='status'){
  const jwt=/^Bearer\s+([^\s]+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!jwt)return reply(401,'unauthenticated');
  try{user=await ctx.resolveUser(jwt)}catch{return reply(503,'auth_unavailable')}
  if(!UUID.test(user?.id||''))return reply(401,'unauthenticated');
  if(!user.emailConfirmed)return reply(403,'email_unverified');
  if(administrative&&user.id.toLowerCase()!==ctx.adminId.toLowerCase())return reply(403,'forbidden');
 }
 let command=payload;
 if(['status','read','resume','test_status'].includes(action)){
  if(Object.keys(payload).length)return reply(400,'unexpected_fields');
 }else if(action==='authorize_test'){
  if(Object.keys(payload).join(',')!=='email'||typeof payload.email!=='string'||payload.email.trim().length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim()))return reply(400,'invalid_email');
  command={email:payload.email.trim().toLowerCase()};
 }else if(action==='admit'){
  if(Object.keys(payload).sort().join(',')!=='captchaToken,terms_version'||typeof payload.terms_version!=='string'||!payload.terms_version.trim()||payload.terms_version.length>120||typeof payload.captchaToken!=='string'||payload.captchaToken.length<1||payload.captchaToken.length>2048)return reply(400,'invalid_request');
  try{if(await ctx.verifyCaptcha(payload.captchaToken)!==true)return reply(403,'captcha_rejected')}catch{return reply(503,'captcha_unavailable')}
  command={terms_version:payload.terms_version};
 }else{
  if(Object.keys(payload).sort().join(',')!=='active_limit,daily_limit,enabled,invitation_hours'||typeof payload.enabled!=='boolean'||!Number.isInteger(payload.daily_limit)||payload.daily_limit<1||payload.daily_limit>20||!Number.isInteger(payload.active_limit)||payload.active_limit<1||payload.active_limit>100||!Number.isInteger(payload.invitation_hours)||payload.invitation_hours<1||payload.invitation_hours>48)return reply(400,'invalid_limits');
 }
 try{
  const out=await ctx.execute(user?.id||null,action,command);
  if(!out||typeof out.ok!=='boolean')return reply(503,'server_unavailable');
  if(!out.ok){const allowed=['admissions_closed','capacity_reached','terms_required','email_unverified','trial_already_used','existing_invitation','no_pending_admission','invalid_email','workspace_exists'];const code=allowed.includes(out.code)?out.code:'admission_unavailable';return reply(code==='capacity_reached'?429:403,code)}
  if(action==='authorize_test')return out.code==='test_authorized'&&!Number.isNaN(Date.parse(out.expires_at||''))?reply(200,'test_authorized',{expires_at:out.expires_at}):reply(503,'server_unavailable');
  if(['status','test_status'].includes(action))return out.code==='available'&&typeof out.terms_version==='string'?reply(200,'available',{terms_version:out.terms_version,sitekey:ctx.sitekey}):reply(503,'server_unavailable');
  if(administrative)return out.code==='settings'&&out.settings&&typeof out.settings==='object'?reply(200,'settings',{settings:out.settings,...(out.runtime?{runtime:out.runtime}:{})}):reply(503,'server_unavailable');
  if(!['grant_ready','workspace_exists'].includes(out.code))return reply(503,'server_unavailable');
  return reply(200,out.code);
 }catch{return reply(503,'server_unavailable')}
}
