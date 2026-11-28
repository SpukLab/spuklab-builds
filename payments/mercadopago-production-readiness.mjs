// Read-only readiness: no creation, charge, cancellation, entitlement or secret output.
export function inspectProductionConfig(config={}){
 const token=typeof config.token==='string'?config.token.trim():'';
 const secret=typeof config.secret==='string'?config.secret.trim():'';
 const merchant=typeof config.merchant==='string'?config.merchant.trim():'';
 const tokenConfigured=/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)&&token!==config.testToken;
 const secretConfigured=secret.length>=16&&secret!==config.testSecret;
 const merchantConfigured=/^\d{1,30}$/.test(merchant)&&!['3813812326','3813812328'].includes(merchant);
 return {tokenConfigured,secretConfigured,merchantConfigured};
}
export function inspectProductionSeller(seller,merchant){
 return !!seller&&String(seller.id)===merchant&&seller.site_id==='MLA'&&
 Array.isArray(seller.tags)&&!seller.tags.includes('test_user')&&
 !['3813812326','3813812328'].includes(String(seller.id));
}
export async function checkProductionReadiness(config,getSeller){
 const fields=inspectProductionConfig(config);
 let sellerVerified=false;
 if(fields.tokenConfigured&&fields.merchantConfigured){
  try{sellerVerified=inspectProductionSeller(await getSeller(),config.merchant.trim());}catch{}
 }
 return {ok:true,code:'readiness_checked',...fields,sellerVerified,
  configurationReady:fields.tokenConfigured&&fields.secretConfigured&&fields.merchantConfigured&&sellerVerified,
  applicationVerified:false,webhookVerified:false,checkoutEnabled:false,chargeCreated:false};
}
