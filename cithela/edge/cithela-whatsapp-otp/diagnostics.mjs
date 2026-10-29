// Signed Supabase Send SMS hooks carry the actual destination in sms.phone.
// In phone_change flows user.phone is still the old (often empty) number.
export function hookRecipientPhone(event){
  const candidate=String(event?.sms?.phone||event?.user?.phone||'').trim();
  const normalized=candidate.replace(/[\s()-]/g,'');
  if(!/^\+?[1-9]\d{7,14}$/.test(normalized))throw Error('invalid_phone');
  return normalized;
}
export const META_TEST_SENDER_ID = '1300517359820775';
export function metaRecipient(phone,senderId){
  const raw=String(phone||'').replace(/[\s()-]/g,'');
  // Supabase Auth signs its Send SMS event with user.phone lacking '+'.
  // Normalize only the transport representation; do not mutate the Auth identity.
  const value=raw.startsWith('+') ? raw : '+'+raw;
  if(!/^\+[1-9]\d{7,14}$/.test(value)) throw Error('invalid_phone');
  return senderId===META_TEST_SENDER_ID && /^\+549\d{10}$/.test(value) ? '54'+value.slice(4) : value.slice(1);
}
export function safeMetaError(status,body){
  const n=body?.error?.code;
  return Number.isInteger(n)&&n>0&&n<1000000 ? 'meta_code_'+n : 'meta_http_'+Number(status);
}
