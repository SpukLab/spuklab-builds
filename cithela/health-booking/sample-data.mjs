// Datos inventados. Nunca utilizar como aranceles o contratos reales.
export const sampleTenants = Object.freeze([
  {tenantId:"dental_demo",profile:"odontologia",name:"Consultorio odontológico (demostración)",services:[
    {id:"consulta",tenantId:"dental_demo",name:"Consulta odontológica",durationMin:30,active:true},
    {id:"control",tenantId:"dental_demo",name:"Control periódico",durationMin:20,active:true}
  ]},
  {tenantId:"med_demo",profile:"medicina",name:"Consultorio médico (demostración)",services:[
    {id:"consulta",tenantId:"med_demo",name:"Consulta médica general",durationMin:30,active:true},
    {id:"control",tenantId:"med_demo",name:"Control clínico",durationMin:20,active:true}
  ]},
  {tenantId:"psych_demo",profile:"psicologia",name:"Consultorio de psicología (demostración)",services:[
    {id:"entrevista",tenantId:"psych_demo",name:"Entrevista inicial",durationMin:50,active:true},
    {id:"sesion",tenantId:"psych_demo",name:"Sesión de seguimiento",durationMin:50,active:true}
  ]}
]);
export const sampleProviders = Object.freeze([
  {id:"entidad_a",name:"Entidad de prueba A",kind:"obra_social",plans:[{id:"basico",name:"Plan estándar"},{id:"plus",name:"Plan ampliado"}]},
  {id:"entidad_b",name:"Entidad de prueba B",kind:"prepaga",plans:[{id:"principal",name:"Plan principal"}]}
]);
export const sampleRules = Object.freeze([
  {tenantId:"dental_demo",serviceId:"consulta",kind:"particular",providerId:null,planId:null,amountMinor:3000000,currency:"ARS",active:true,status:"orientativo",validUntil:null},
  {tenantId:"dental_demo",serviceId:"consulta",kind:"obra_social",providerId:"entidad_a",planId:"basico",amountMinor:600000,currency:"ARS",active:true,status:"orientativo",validUntil:"2027-01-31"},
  {tenantId:"dental_demo",serviceId:"consulta",kind:"obra_social",providerId:"entidad_a",planId:"plus",amountMinor:null,currency:"ARS",active:true,status:"a_confirmar",validUntil:null},
  {tenantId:"dental_demo",serviceId:"control",kind:"particular",providerId:null,planId:null,amountMinor:2000000,currency:"ARS",active:true,status:"orientativo",validUntil:null},
  {tenantId:"med_demo",serviceId:"consulta",kind:"particular",providerId:null,planId:null,amountMinor:3500000,currency:"ARS",active:true,status:"orientativo",validUntil:null},
  {tenantId:"med_demo",serviceId:"consulta",kind:"prepaga",providerId:"entidad_b",planId:"principal",amountMinor:500000,currency:"ARS",active:true,status:"orientativo",validUntil:null},
  {tenantId:"psych_demo",serviceId:"entrevista",kind:"particular",providerId:null,planId:null,amountMinor:4000000,currency:"ARS",active:true,status:"orientativo",validUntil:null},
  {tenantId:"psych_demo",serviceId:"sesion",kind:"obra_social",providerId:"entidad_a",planId:"basico",amountMinor:null,currency:"ARS",active:true,status:"a_confirmar",validUntil:null}
]);
