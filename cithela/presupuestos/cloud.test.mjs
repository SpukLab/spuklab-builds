import test from "node:test";
import assert from "node:assert/strict";
import {createQuoteCloudApi,validateCloudRole,quoteError,connectQuoteCloud} from "./cloud.mjs";

const TENANT="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function mock(){
  const calls=[];
  const client={rpc:async(name,payload)=>{
    calls.push({name,payload});
    return {data:{ok:true,quotes:[],catalog:[],id:"quote"},error:null};
  },from:(table)=>({
    select:(fields)=>({
      eq:(field,tenant)=>({order:async()=>({data:[{id:"demo",display_name:"Demo"}],error:null})})
    })
  })};
  return {client,calls};
}
test("only professional memberships can use quote module",()=>{
  assert.equal(validateCloudRole({tenant_id:TENANT,role:"operator"}),true);
  for(const role of ["viewer","patient","",null])assert.equal(validateCloudRole({tenant_id:TENANT,role}),false);
});
test("quote save sends only fixed payload and server-calculated total",async()=>{
  const {client,calls}=mock(),api=createQuoteCloudApi(client,TENANT);
  await api.save({personId:"bbbbb",items:[{name:"Limpieza",quantity:1,unitMinor:250000,totalMinor:1}],discountMinor:100,validityDays:7,requestId:"request-00001"});
  assert.equal(calls[0].name,"cithela_quote_command");
  const p=calls[0].payload;
  assert.equal(p.p_command,"quote.save");
  assert.equal(p.p_payload.items[0].unit_minor,250000);
  assert.equal(p.p_payload.items[0].total_minor,undefined);
  assert.equal(p.p_request_id,"request-00001");
  assert.equal(p.p_tenant_id,TENANT);
});
test("quote update checks server version",async()=>{
  const {client,calls}=mock(),api=createQuoteCloudApi(client,TENANT);
  await api.save({id:"quoteid",personId:"person",items:[],discountMinor:0,validityDays:7,expectedUpdatedAt:"2026-11-15T10:00:00+00:00",requestId:"request-00002"});
  assert.equal(calls[0].payload.p_payload.expected_updated_at,"2026-11-15T10:00:00+00:00");
});
test("status only sends intended fields",async()=>{
  const {client,calls}=mock(),api=createQuoteCloudApi(client,TENANT);
  await api.status({id:"1",status:"aceptado",expectedUpdatedAt:"2026-11-15"});
  assert.deepEqual(Object.keys(calls[0].payload.p_payload).sort(),["expected_updated_at","id","status"]);
});
test("client surfaces error codes without hiding denial",async()=>{
  const {client}=mock();
  client.rpc=async()=>({data:{ok:false,code:"forbidden"},error:null});
  await assert.rejects(createQuoteCloudApi(client,TENANT).catalog(),/permiso/);
  assert.match(quoteError("stale_write"),/Otro dispositivo/);
});
test("invalid tenant config is refused",()=>{
  const {client}=mock();
  assert.throws(()=>createQuoteCloudApi(client,"not-uuid"));
});

test("catalog edit and archive include expected revision for multi-device safety",async()=>{
  const {client,calls}=mock(),api=createQuoteCloudApi(client,TENANT);
  await api.catalogSave({id:"catalog-id",name:"Consulta",unitMinor:105000,
    expectedUpdatedAt:"2026-11-15T20:00:00Z"});
  assert.deepEqual(calls[0].payload.p_payload,{
    id:"catalog-id",expected_updated_at:"2026-11-15T20:00:00Z",
    name:"Consulta",unit_minor:105000
  });
  await api.catalogArchive({id:"catalog-id",expectedUpdatedAt:"2026-11-15T20:00:01Z"});
  assert.deepEqual(calls[1].payload.p_payload,{
    id:"catalog-id",expected_updated_at:"2026-11-15T20:00:01Z"
  });
});

test("tenant selection is restricted to the requested professional membership",async()=>{
  const tenantB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const memberships=[
    {tenant_id:TENANT,role:"owner",created_at:"2026-01-01"},
    {tenant_id:tenantB,role:"operator",created_at:"2026-02-01"}
  ];
  const data={cithela_tenant_memberships:memberships,
    cithela_tenants:[{id:TENANT,display_name:"Establecimiento A",status:"active"},
                     {id:tenantB,display_name:"Establecimiento B",status:"active"}]};
  const makeQuery=(table)=>({
    rows:data[table]||[],
    select(){return this;},
    eq(column,value){this.rows=this.rows.filter(row=>row[column]===value);return this;},
    order(){return this;},
    limit(n){return Promise.resolve({data:this.rows.slice(0,n),error:null});},
    single(){return Promise.resolve({data:this.rows[0]||null,error:null})}
  });
  const fakeClient={
    auth:{getSession:async()=>({data:{session:{user:{id:"demo-owner"}}},error:null})},
    from:makeQuery,rpc:async()=>({data:{ok:true,quotes:[]},error:null})
  };
  const lib={createClient:()=>fakeClient};
  const result=await connectQuoteCloud(lib,tenantB);
  assert.equal(result.tenant.id,tenantB);
  assert.equal(result.role,"operator");
  assert.equal(result.api.tenantId,tenantB);
  await assert.rejects(connectQuoteCloud(lib,"cccccccc-cccc-4ccc-8ccc-cccccccccccc"),/establecimiento profesional/);
  await assert.rejects(connectQuoteCloud(lib,"../other-tenant"),/inválido/);
});

test("la habilitación odontológica se lee de servidor y está cerrada por defecto",async()=>{
  const {client,calls}=mock(),api=createQuoteCloudApi(client,TENANT);
  client.rpc=async(name,payload)=>{
    calls.push({name,payload});
    return {data:{ok:true,dental_enabled:false},error:null};
  };
  assert.deepEqual(await api.settings(),{dentalEnabled:false});
  assert.equal(calls[0].payload.p_command,"settings.get");
});
test("presupuesto particular no inyecta cobertura si falta habilitación",async()=>{
  const {client,calls}=mock(),api=createQuoteCloudApi(client,TENANT);
  await api.save({personId:"person",items:[],discountMinor:0,validityDays:7,requestId:"request-unique-23"});
  assert.equal(Object.hasOwn(calls[0].payload.p_payload,"dental_coverage"),false);
});
test("cobertura solo envía campos declarados, no sumas ni afiliación",async()=>{
  const {client,calls}=mock(),api=createQuoteCloudApi(client,TENANT);
  const coverage={kind:"obra_social",provider:"Ficticia",plan:"A",status:"autorizada",covered_minor:1000};
  await api.save({personId:"person",items:[],discountMinor:0,validityDays:7,requestId:"request-unique-24",dentalCoverage:coverage});
  assert.deepEqual(calls[0].payload.p_payload.dental_coverage,coverage);
  assert.equal(Object.hasOwn(calls[0].payload.p_payload,"total_minor"),false);
  await api.save({personId:"person",items:[],discountMinor:0,validityDays:7,requestId:"request-unique-25",dentalCoverage:null});
  assert.equal(calls[1].payload.p_payload.dental_coverage,null);
});
