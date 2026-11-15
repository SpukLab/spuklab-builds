// CITHELA quotes: client-side adapter, no service_role and no direct quote table access.
// Uses the SAME Supabase URL/publishable key/session persistence as cithela/index.html.
export const CITHELA_QUOTE_DB = Object.freeze({
  url: "https://mcqknmqhtmihegmifuka.supabase.co",
  publishable: "sb_publishable__QKhInQSZjLyncQsQoRJzw_dQuwf5jc"
});
const CODE_LABELS = Object.freeze({
  unauthenticated:"Tu sesión expiró. Volvé a ingresar a CITHELA.",
  forbidden:"Tu usuario no tiene permiso para utilizar Presupuestos.",
  tenant_inactive:"El establecimiento está inactivo.",
  feature_disabled:"Presupuestos todavía no está habilitado para este establecimiento.",
  invalid_payload:"Revisá los datos del presupuesto.",
  person_not_found:"El paciente no pertenece a este establecimiento.",
  service_not_found:"No se encontró ese servicio.",
  quote_immutable:"Este presupuesto ya se envió y no puede editarse.",
  stale_write:"Otro dispositivo modificó el presupuesto. Actualizá la lista.",
  invalid_transition:"Ese cambio de estado no es válido.",
  idempotency_conflict:"La solicitud ya se utilizó con datos distintos.",
  conflict_retry:"Hubo un conflicto al guardar. Reintentá después de actualizar.",
  discount_exceeds_subtotal:"El descuento supera el valor del presupuesto.",
  amount_limit:"El importe supera el máximo permitido.",
  catalog_limit:"Se alcanzó el límite de servicios valorizados.",
  not_found:"El presupuesto ya no está disponible.",
  missing_version:"Actualizá el presupuesto antes de guardarlo."
});
export function quoteError(code) {
  return CODE_LABELS[code] || "No se pudo completar la operación (" + String(code||"error") + ").";
}
export function validateCloudRole(membership) {
  return !!membership && ["owner","admin","operator"].includes(membership.role) && !!membership.tenant_id;
}
export function createQuoteCloudApi(client,tenantId) {
  if(!client?.rpc || !client?.from || !/^[0-9a-f-]{36}$/i.test(String(tenantId||""))) {
    throw new TypeError("No se pudo configurar el establecimiento.");
  }
  const rpc = async (command,payload={},requestId=globalThis.crypto?.randomUUID?.()||"quote-read-"+Date.now()) => {
    const {data,error}=await client.rpc("cithela_quote_command",{
      p_tenant_id:tenantId,p_request_id:requestId,p_command:command,p_payload:payload
    });
    if(error)throw new Error(error.code==="PGRST202"?"Presupuestos todavía no está habilitado en este establecimiento.":error.message);
    if(!data?.ok)throw new Error(quoteError(data?.code));
    return data;
  };
  const query = async(table,fields) => {
    const {data,error}=await client.from(table).select(fields)
      .eq("tenant_id",tenantId).order(table==="cithela_people"?"display_name":"name");
    if(error)throw new Error(error.message);
    return data||[];
  };
  return Object.freeze({
    tenantId,
    people:()=>query("cithela_people","id,display_name"),
    services:()=>query("cithela_services","id,name,active"),
    catalog:()=>rpc("catalog.list").then(x=>x.catalog),
    quotes:(personId)=>rpc("quote.list",personId?{person_id:personId}:{}).then(x=>x.quotes),
    save:({id,personId,items,discountMinor,validityDays,expectedUpdatedAt,requestId})=>
      rpc("quote.save",{
        ...(id?{id,expected_updated_at:expectedUpdatedAt}:{}),
        person_id:personId,items:items.map(l=>({
          name:l.name,quantity:l.quantity,unit_minor:l.unitMinor
        })),discount_minor:discountMinor,validity_days:validityDays
      },requestId),
    status:({id,status,expectedUpdatedAt})=>
      rpc("quote.status",{id,status,expected_updated_at:expectedUpdatedAt}),
    catalogSave:({id,serviceId,name,unitMinor,expectedUpdatedAt})=>
      rpc("catalog.upsert",{
        ...(id?{id,expected_updated_at:expectedUpdatedAt}:{}),
        ...(serviceId?{service_id:serviceId}:{}),
        name,unit_minor:unitMinor
      }),
    catalogArchive:({id,expectedUpdatedAt})=>
      rpc("catalog.archive",{id,expected_updated_at:expectedUpdatedAt})
  });
}
export async function connectQuoteCloud(supabaseLib) {
  if(!supabaseLib?.createClient)throw new Error("No se pudo cargar la conexión a CITHELA.");
  const client=supabaseLib.createClient(CITHELA_QUOTE_DB.url,CITHELA_QUOTE_DB.publishable,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {data:sessionResult,error:sessionError}=await client.auth.getSession();
  if(sessionError)throw sessionError;
  if(!sessionResult?.session)throw new Error("Primero ingresá como profesional en CITHELA.");
  const {data:memberships,error:membershipError}=await client
    .from("cithela_tenant_memberships")
    .select("tenant_id,role,created_at")
    .order("created_at",{ascending:true}).limit(1);
  if(membershipError)throw membershipError;
  const membership=memberships?.[0]||null;
  if(!validateCloudRole(membership))throw new Error("La cuenta no tiene un establecimiento profesional habilitado.");
  const {data:tenant,error:tenantError}=await client.from("cithela_tenants")
    .select("id,display_name,status")
    .eq("id",membership.tenant_id).single();
  if(tenantError)throw tenantError;
  if(tenant?.status!=="active")throw new Error("Este establecimiento está inactivo.");
  return {api:createQuoteCloudApi(client,membership.tenant_id),
    tenant,role:membership.role,client,userId:sessionResult.session.user.id};
}
