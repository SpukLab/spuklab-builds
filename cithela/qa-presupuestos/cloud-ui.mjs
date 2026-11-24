import {pesosToMinor,moneyARS,makeLine,calculateQuote,whatsappSummary} from "./core.mjs";
import {connectQuoteCloud} from "./cloud.mjs";
import {dentalPaymentBreakdown,dentalCoverageNote} from "./odontologia.mjs";

const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state={
  api:null,tenant:null,role:null,dentalEnabled:false,
  people:[],services:[],catalog:[],quotes:[],
  lines:[],current:null,dirty:false,pendingRequest:null,busy:false,editingCatalogId:null,
  selectedPersonId:"",sessionEpoch:0
};
function message(msg,error=false){
  $("feedback").textContent=msg;
  $("feedback").style.color=error?"#8e3548":"#23665e";
}
function bootstrapMessage(msg,error=false){
  $("bootstrap-message").textContent=msg;
  $("bootstrap-message").className="message"+(error?" error":"");
  $("bootstrap-message").hidden=false;
}
function currentPerson(){return state.people.find(p=>p.id===$("patient").value)||null;}
function storedReady(){return !!state.current&&!state.dirty;}
function isDraft(){return !state.current||state.current.status==="borrador";}
function isEditable(){return !state.busy&&isDraft();}
function buildSnapshot(){return calculateQuote(state.lines,pesosToMinor($("discount").value));}
function dentalForm(totalMinor){
  if(!state.dentalEnabled)return undefined;
  const kind=$("dental-kind").value;
  if(kind==="particular")return null;
  const status=$("dental-status").value;
  const coverage=dentalPaymentBreakdown(totalMinor,{
    kind,provider:$("dental-provider").value,plan:$("dental-plan").value,status,
    coveredMinor:status==="autorizada"?pesosToMinor($("dental-amount").value):null
  }).coverage;
  return {kind:coverage.kind,provider:coverage.provider,plan:coverage.plan,
    status:coverage.status,covered_minor:coverage.coveredMinor};
}
function savedDentalNote(quote){
  if(!state.dentalEnabled||!quote?.dental_coverage)return "";
  const d=quote.dental_coverage;
  return dentalCoverageNote(Number(quote.total_minor),{
    kind:d.kind,provider:d.provider,plan:d.plan,status:d.status,coveredMinor:d.covered_minor
  },moneyARS);
}
function resetDental(coverage=null){
  $("dental-kind").value=coverage?.kind||"particular";
  $("dental-provider").value=coverage?.provider||"";
  $("dental-plan").value=coverage?.plan||"";
  $("dental-status").value=coverage?.status||"sin_verificar";
  $("dental-amount").value=coverage?.covered_minor===null||coverage?.covered_minor===undefined
    ?"0":String(Number(coverage.covered_minor)/100);
}
function markDirty(){state.pendingRequest=null;if(state.current)state.dirty=true;render();}
function unsavedWork(){
  return state.dirty||(!state.current&&(
    state.lines.length>0||$("line-name").value.trim()!==""||
    $("line-price").value.trim()!==""||$("discount").value.trim()!=="0"
  ));
}
function confirmDiscard(){
  return !unsavedWork()||window.confirm("Hay cambios sin guardar. ¿Querés descartarlos?");
}
// The server response confirms persistence; a separate list-refresh failure must
// never turn a successful save into a duplicate creation on retry.
function keepSavedQuote(quote){
  state.current=quote;state.dirty=false;state.pendingRequest=null;
  state.selectedPersonId=quote.person_id;
  state.quotes=[quote,...state.quotes.filter(x=>x.id!==quote.id)];
}
async function updateSavedHistory(local,successText){
  try{
    await refreshQuotes();
    const found=state.quotes.find(x=>x.id===local.id);
    if(found)loadQuote(local.id);
    else state.quotes.unshift(local);
    message(successText);
  }catch{
    // Preserve the server-confirmed record even if the history endpoint is unavailable.
    state.quotes=[local,...state.quotes.filter(x=>x.id!==local.id)];
    message(successText+" El historial no se pudo actualizar; probá nuevamente más tarde.",true);
  }
}
function renderCatalog(){
  $("catalog-edit").innerHTML='<option value="">+ Nuevo precio</option>'+
    state.catalog.map(i=>'<option value="'+escape(i.id)+'">'+escape(i.name)+(i.active?'':' (archivado)')+'</option>').join("");
  $("catalog-edit").value=state.editingCatalogId||"";
  $("archive-cat").disabled=!state.editingCatalogId;
  $("catalog-select").innerHTML='<option value="">Concepto personalizado</option>'+
    state.catalog.filter(i=>i.active).map(i=>
      '<option value="'+escape(i.id)+'">'+escape(i.name)+' · '+escape(moneyARS(Number(i.unit_minor)))+'</option>').join("");
  $("service-id").innerHTML='<option value="">No vincular</option>'+
    state.services.filter(s=>s.active).map(s=>
      '<option value="'+escape(s.id)+'">'+escape(s.name)+'</option>').join("");
}
function renderQuotes(){
  $("quote-list").innerHTML=state.quotes.length?state.quotes.map(q=>{
    const current=state.current?.id===q.id?" current":"";
    const classes={enviado:"sent",aceptado:"accepted",rechazado:"rejected"};
    return '<button class="list-button'+current+'" type="button" data-quote="'+escape(q.id)+'">'+
      '<strong>'+escape(q.reference)+' · '+escape(moneyARS(Number(q.total_minor)))+'</strong>'+
      '<small>'+escape(q.status.toUpperCase())+' · '+escape(new Date(q.created_at).toLocaleDateString("es-AR"))+'</small></button>';
  }).join(""):'<p class="muted">Este paciente aún no tiene presupuestos.</p>';
  $("quote-list").querySelectorAll("[data-quote]").forEach(button=>{
    button.addEventListener("click",()=>loadQuote(button.dataset.quote));
  });
}
function render(){
  const editable=isEditable();
  $("dental-panel").hidden=!state.dentalEnabled;
  const covered=state.dentalEnabled&&$("dental-kind").value!=="particular";
  $("dental-fields").hidden=!covered;
  $("dental-amount-row").hidden=!covered||$("dental-status").value!=="autorizada";
  for(const id of ["dental-kind","dental-provider","dental-plan","dental-status","dental-amount"]){
    $(id).disabled=!editable||!state.dentalEnabled;
  }
  $("tenant-name").textContent=state.tenant?.display_name||"Establecimiento";
  const roleLabels={owner:"Propietario",admin:"Administrador",operator:"Operador"};
  $("role-name").textContent="Acceso: "+(roleLabels[state.role]||"Profesional");
  $("quote-status").textContent=state.current
    ?state.current.status[0].toUpperCase()+state.current.status.slice(1)
    :"Borrador nuevo";
  $("quote-status").className="status"+(state.current?.status==="enviado"?" sent":state.current?.status==="aceptado"?" accepted":state.current?.status==="rechazado"?" rejected":"");
  $("lines").innerHTML=state.lines.length?state.lines.map((line,i)=>
    '<div class="item"><div><strong>'+escape(line.name)+'</strong>'+
    '<small>'+line.quantity+' × '+escape(moneyARS(line.unitMinor))+'</small>'+
    (editable?'<div><button data-remove="'+i+'" type="button">Quitar</button></div>':"")+
    '</div><strong>'+escape(moneyARS(line.totalMinor))+'</strong></div>'
  ).join(""):'<p class="muted">Agregá al menos un concepto para generar el presupuesto.</p>';
  $("lines").querySelectorAll("[data-remove]").forEach(button=>button.addEventListener("click",()=>{
    if(!isEditable())return;
    state.lines.splice(Number(button.dataset.remove),1);
    markDirty();
  }));
  $("reference").value=state.current?.reference||"";
  for(const id of ["validity","discount","catalog-select","line-name","line-price","line-quantity","add-line"]){
    $(id).disabled=!editable;
  }
  $("patient").disabled=state.busy||!!state.current; // Cambiar paciente exige comenzar nuevo.
  $("save-quote").disabled=!editable||!currentPerson()||!state.lines.length;
  $("save-quote").textContent=state.busy?"Guardando…":
    !state.current?"Guardar presupuesto":
    state.current.status==="borrador"?"Actualizar borrador":
    ({enviado:"Presupuesto enviado",aceptado:"Presupuesto aceptado",
      rechazado:"Presupuesto rechazado"}[state.current.status]||"Solo lectura");
  $("duplicate-quote").hidden=!state.current;
  $("duplicate-quote").disabled=!state.current||state.busy;
  $("print-quote").disabled=!storedReady()||state.busy;
  $("prepare-share").disabled=!storedReady()||state.busy;
  $("mark-sent").disabled=!storedReady()||state.current.status!=="borrador"||state.busy;
  $("mark-accepted").disabled=!storedReady()||state.current.status!=="enviado"||state.busy;
  $("mark-rejected").disabled=!storedReady()||!["borrador","enviado"].includes(state.current.status)||state.busy;
  try{
    const q=buildSnapshot();
    $("subtotal").textContent=moneyARS(q.subtotalMinor);
    $("total").textContent=moneyARS(q.totalMinor);
    if(state.dentalEnabled){
      const dental=dentalForm(q.totalMinor);
      $("dental-summary").textContent=dental
        ?dentalCoverageNote(q.totalMinor,{
          kind:dental.kind,provider:dental.provider,plan:dental.plan,
          status:dental.status,coveredMinor:dental.covered_minor
        },moneyARS)
        :"Atención particular.";
    }
  }catch(e){
    $("subtotal").textContent="—";$("total").textContent="—";
    if(state.lines.length)message(e.message,true);
  }
  renderQuotes();
}
async function refreshQuotes(){
  const personId=currentPerson()?.id;
  const api=state.api;
  const epoch=state.sessionEpoch;
  if(!personId){state.quotes=[];render();return;}
  const quotes=await api.quotes(personId);
  if(state.api!==api||state.sessionEpoch!==epoch||currentPerson()?.id!==personId)return;
  state.quotes=quotes;
  render();
}
function newQuote(clearPatient=false){
  state.current=null;state.lines=[];state.dirty=false;state.pendingRequest=null;
  if(clearPatient)$("patient").value="";
  state.selectedPersonId=$("patient").value;
  $("discount").value="0";$("validity").value="7";
  resetDental();
  $("line-name").value="";$("line-price").value="";$("line-quantity").value="1";$("catalog-select").value="";
  message("");
  render();
}
function loadQuote(id){
  const quote=state.quotes.find(q=>q.id===id);
  if(!quote||!confirmDiscard())return;
  state.current=quote;state.pendingRequest=null;state.dirty=false;
  $("patient").value=quote.person_id;
  state.selectedPersonId=quote.person_id;
  state.lines=quote.items.map(l=>makeLine({name:l.name,quantity:Number(l.quantity),unitMinor:Number(l.unit_minor)}));
  $("discount").value=String(Number(quote.discount_minor)/100);
  $("validity").value=String(quote.validity_days);
  resetDental(quote.dental_coverage);
  message("");render();
}
function duplicateQuote(){
  if(!state.current||state.busy||!confirmDiscard())return;
  const previous=state.current;
  state.lines=previous.items.map(item=>makeLine({
    name:item.name,quantity:Number(item.quantity),unitMinor:Number(item.unit_minor)
  }));
  state.current=null;state.dirty=false;state.pendingRequest=null;
  state.selectedPersonId=previous.person_id;
  $("patient").value=previous.person_id;
  $("discount").value=String(Number(previous.discount_minor)/100);
  $("validity").value=String(previous.validity_days);
  resetDental(previous.dental_coverage);
  $("line-name").value="";$("line-price").value="";$("catalog-select").value="";
  render();
  message("Copia lista como borrador nuevo. El presupuesto original no cambió.");
}
async function runBusy(task){
  if(state.busy)return;
  state.busy=true;render();
  try{await task();}catch(e){message(e.message||"No se pudo completar la acción.",true);}
  finally{state.busy=false;render();}
}
async function save(){
  if(!isDraft()||!currentPerson())return;
  await runBusy(async()=>{
    const quote=buildSnapshot();
    const dentalCoverage=dentalForm(quote.totalMinor);
    const personId=currentPerson().id;
    const prior=state.current;
    const api=state.api,epoch=state.sessionEpoch;
    const validityDays=Number($("validity").value);
    const requestId=state.pendingRequest||(state.pendingRequest=crypto.randomUUID());
    const result=await api.save({
      ...(prior?{id:prior.id,expectedUpdatedAt:prior.updated_at}:{}),
      personId,items:quote.lines,discountMinor:quote.discountMinor,
      validityDays,requestId,dentalCoverage
    });
    if(state.sessionEpoch!==epoch||state.api!==api)return;
    const snapshot={
      ...prior,id:result.id,reference:result.reference,
      status:result.status||prior?.status||"borrador",
      person_id:personId,created_at:prior?.created_at||new Date().toISOString(),
      updated_at:result.updated_at,currency:"ARS",
      items:quote.lines.map(l=>({
        name:l.name,quantity:l.quantity,unit_minor:l.unitMinor,total_minor:l.totalMinor
      })),
      subtotal_minor:quote.subtotalMinor,discount_minor:quote.discountMinor,
      total_minor:result.total_minor,validity_days:validityDays,
      dental_coverage:dentalCoverage===undefined?(prior?.dental_coverage||null):dentalCoverage
    };
    keepSavedQuote(snapshot);
    await updateSavedHistory(snapshot,prior?"Borrador actualizado.":"Presupuesto guardado.");
  });
}
async function changeStatus(next){
  if(!storedReady())return;
  const dialog={
    enviado:"¿Confirmás que compartiste este presupuesto con el paciente?",
    aceptado:"¿Confirmás la aceptación comunicada por el paciente?",
    rechazado:"¿Confirmás que fue rechazado?"
  }[next];
  if(!window.confirm(dialog))return;
  await runBusy(async()=>{
    const before=state.current,api=state.api,epoch=state.sessionEpoch;
    const result=await api.status({
      id:before.id,status:next,expectedUpdatedAt:before.updated_at
    });
    if(state.sessionEpoch!==epoch||state.api!==api)return;
    const confirmed={
      ...before,status:result.status,updated_at:result.updated_at,
      sent_at:next==="enviado"?new Date().toISOString():before.sent_at,
      decided_at:["aceptado","rechazado"].includes(next)?new Date().toISOString():before.decided_at
    };
    keepSavedQuote(confirmed);
    await updateSavedHistory(confirmed,"Estado confirmado: "+next+".");
  });
}
function printQuote(){
  if(!storedReady())return;
  const q=state.current,person=currentPerson();
  $("print-prof").textContent=state.tenant.display_name;
  $("print-meta").textContent="Paciente: "+person.display_name+" · Ref. "+q.reference+
    " · Emitido: "+new Date(q.created_at).toLocaleDateString("es-AR")+
    " · Validez: "+q.validity_days+" días";
  $("print-lines").innerHTML=q.items.map(l=>
    "<tr><td>"+escape(l.name)+" × "+Number(l.quantity)+"</td><td>"+
    escape(moneyARS(Number(l.total_minor)))+"</td></tr>").join("");
  $("print-sub").textContent="Subtotal: "+moneyARS(Number(q.subtotal_minor));
  $("print-disc").textContent=Number(q.discount_minor)>0?"Descuento: −"+moneyARS(Number(q.discount_minor)):"";
  $("print-total").textContent="Total estimado: "+moneyARS(Number(q.total_minor));
  $("print-dental").textContent=savedDentalNote(q);
  window.print();
}
function shareQuote(){
  if(!storedReady())return;
  const q=state.current;
  // Se imprime el snapshot guardado, nunca valores sin guardar.
  $("share-text").value=whatsappSummary({
    professional:state.tenant.display_name,patient:currentPerson().display_name,
    reference:q.reference,validity:q.validity_days+" días",
    quote:{currency:"ARS",lines:q.items.map(l=>({
      name:l.name,quantity:Number(l.quantity),unitMinor:Number(l.unit_minor),totalMinor:Number(l.total_minor)
    })),subtotalMinor:Number(q.subtotal_minor),discountMinor:Number(q.discount_minor),totalMinor:Number(q.total_minor)}
  })+(savedDentalNote(q)?"\n\n"+savedDentalNote(q):"");
  $("copy-feedback").textContent="";
  $("share-dialog").showModal();
}
function populatePeople(){
  $("patient").innerHTML='<option value="">Seleccioná un paciente</option>'+
    state.people.map(p=>'<option value="'+escape(p.id)+'">'+escape(p.display_name)+'</option>').join("");
}
function mountEvents(){
  for(const id of ["dental-kind","dental-provider","dental-plan","dental-status","dental-amount"]){
    $(id).addEventListener(["dental-provider","dental-plan","dental-amount"].includes(id)?"input":"change",markDirty);
  }
  document.querySelector("header .return")?.addEventListener("click",event=>{
    if(!confirmDiscard())event.preventDefault();
  });
  $("new-quote").addEventListener("click",()=>{
    if(confirmDiscard())newQuote();
  });
  $("patient").addEventListener("change",()=>{
    const next=$("patient").value;
    if(!confirmDiscard()){
      $("patient").value=state.selectedPersonId;
      return;
    }
    newQuote();
    state.selectedPersonId=next;
    runBusy(refreshQuotes);
  });
  $("catalog-select").addEventListener("change",()=>{
    const found=state.catalog.find(x=>x.id===$("catalog-select").value);
    if(found){$("line-name").value=found.name;$("line-price").value=String(Number(found.unit_minor)/100);}
  });
  $("add-line").addEventListener("click",()=>{
    if(!isEditable())return;
    try{
      if(state.lines.length>=50)throw new RangeError("Máximo 50 conceptos.");
      const line=makeLine({name:$("line-name").value,unitMinor:pesosToMinor($("line-price").value),
        quantity:Number($("line-quantity").value)});
      state.lines.push(line);
      $("line-name").value="";$("line-price").value="";$("line-quantity").value="1";$("catalog-select").value="";
      markDirty();
    }catch(e){message(e.message,true);}
  });
  $("discount").addEventListener("input",markDirty);
  $("validity").addEventListener("change",markDirty);
  $("save-quote").addEventListener("click",save);
  $("duplicate-quote").addEventListener("click",duplicateQuote);
  $("print-quote").addEventListener("click",printQuote);
  $("prepare-share").addEventListener("click",shareQuote);
  $("mark-sent").addEventListener("click",()=>changeStatus("enviado"));
  $("mark-accepted").addEventListener("click",()=>changeStatus("aceptado"));
  $("mark-rejected").addEventListener("click",()=>changeStatus("rechazado"));
  $("catalog-edit").addEventListener("change",()=>{
    state.editingCatalogId=$("catalog-edit").value||null;
    const item=state.catalog.find(i=>i.id===state.editingCatalogId);
    $("cat-name").value=item?.name||"";
    $("cat-price").value=item?String(Number(item.unit_minor)/100):"";
    $("service-id").value=item?.service_id||"";
    $("archive-cat").disabled=!item;
  });
  $("archive-cat").addEventListener("click",()=>{
    if(!state.editingCatalogId||!window.confirm("¿Archivar este precio? Los presupuestos anteriores no cambian."))return;
    runBusy(async()=>{
      const existing=state.catalog.find(item=>item.id===state.editingCatalogId);
      if(!existing)throw new Error("Actualizá el catálogo antes de archivar.");
      await state.api.catalogArchive({id:existing.id,expectedUpdatedAt:existing.updated_at});
      state.editingCatalogId=null;
      state.catalog=await state.api.catalog();
      renderCatalog();
      $("cat-name").value="";$("cat-price").value="";$("service-id").value="";
      message("Precio archivado. Los presupuestos guardados conservan sus importes.");
    });
  });
  $("save-cat").addEventListener("click",()=>runBusy(async()=>{
    if(!["owner","admin"].includes(state.role))throw new Error("No tenés permiso para editar precios.");
    const name=$("cat-name").value.trim();
    const unitMinor=pesosToMinor($("cat-price").value);
    const existing=state.catalog.find(item=>item.id===state.editingCatalogId);
    await state.api.catalogSave({id:state.editingCatalogId,
      expectedUpdatedAt:existing?.updated_at,
      name,unitMinor,serviceId:$("service-id").value});
    state.editingCatalogId=null;
    state.catalog=await state.api.catalog();
    renderCatalog();
    $("cat-name").value="";$("cat-price").value="";$("service-id").value="";
    message("Servicio valorizado guardado.");
  }));
  $("close-share").addEventListener("click",()=>$("share-dialog").close());
  $("copy-share").addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText($("share-text").value);
      $("copy-feedback").textContent="Texto copiado. Verificá el destinatario antes de enviarlo.";
    }catch{
      $("share-text").focus();$("share-text").select();
      $("copy-feedback").textContent="Copiá el texto seleccionado manualmente.";
    }
  });
}
async function initialize(){
  try{
    const targetParams=new URLSearchParams(window.location.hash.replace(/^#/,""));
    const preferredTenant=targetParams.get("tenant");
    const {api,tenant,role,client,userId}=await connectQuoteCloud(window.supabase,preferredTenant);
    state.api=api;state.tenant=tenant;state.role=role;
    // Clear patient-related data if the professional session ends in any tab.
    client.auth.onAuthStateChange((event,session)=>{
      const switched=event==="SIGNED_IN"&&!!session?.user?.id&&session.user.id!==userId;
      if(event!=="SIGNED_OUT"&&!switched)return;
      state.sessionEpoch++;
      state.people=[];state.services=[];state.catalog=[];state.quotes=[];
      state.lines=[];state.current=null;state.pendingRequest=null;state.api=null;
      state.tenant=null;state.selectedPersonId="";state.dentalEnabled=false;
      if($("share-dialog").open)$("share-dialog").close();
      $("patient").innerHTML="";
      $("quote-list").textContent="";
      $("lines").textContent="";
      $("share-text").value="";
      $("print-lines").textContent="";
      $("print-prof").textContent="";
      $("print-meta").textContent="";
      $("print-sub").textContent="";
      $("print-disc").textContent="";
      $("print-total").textContent="";
      $("print-dental").textContent="";
      $("dental-summary").textContent="";
      resetDental();
      $("tenant-name").textContent="";
      $("workspace").hidden=true;
      bootstrapMessage(switched
        ?"Cambió la cuenta profesional. Volvé a ingresar para cargar el establecimiento correcto."
        :"La sesión se cerró. Volvé a ingresar desde CITHELA.",true);
    });
    const [people,catalog,services,settings]=await Promise.all([api.people(),api.catalog(),api.services(),api.settings()]);
    if(state.api!==api)return; // An auth change may have invalidated this pending load.
    state.people=people;state.catalog=catalog;state.services=services;
    state.dentalEnabled=settings.dentalEnabled;
    populatePeople();renderCatalog();mountEvents();
    $("catalog-admin").hidden=!["owner","admin"].includes(role);
    $("workspace").hidden=false;
    $("bootstrap-message").hidden=true;
    newQuote();
    // Prefill from the patient's card; accept only a person in this tenant.
    const target=targetParams.get("person");
    if(target && state.people.some(p=>p.id===target)){
      $("patient").value=target;
      state.selectedPersonId=target;
      await refreshQuotes();
    }
    if(!people.length)message("Primero cargá un paciente desde la agenda CITHELA.");
  }catch(e){
    bootstrapMessage(e.message||"No se pudo cargar Presupuestos.",true);
  }
}
initialize();
