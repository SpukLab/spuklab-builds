import {pesosToMinor,moneyARS,makeLine,calculateQuote,whatsappSummary} from "./core.mjs";
import {connectQuoteCloud} from "./cloud.mjs";

const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state={
  api:null,tenant:null,role:null,
  people:[],services:[],catalog:[],quotes:[],
  lines:[],current:null,dirty:false,pendingRequest:null,busy:false,editingCatalogId:null
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
function markDirty(){state.pendingRequest=null;if(state.current)state.dirty=true;render();}
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
  $("tenant-name").textContent=state.tenant?.display_name||"Establecimiento";
  $("role-name").textContent="Rol: "+state.role;
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
  $("save-quote").textContent=state.busy?"Guardando…":state.current?"Actualizar borrador":"Guardar presupuesto";
  $("print-quote").disabled=!storedReady()||state.busy;
  $("prepare-share").disabled=!storedReady()||state.busy;
  $("mark-sent").disabled=!storedReady()||state.current.status!=="borrador"||state.busy;
  $("mark-accepted").disabled=!storedReady()||state.current.status!=="enviado"||state.busy;
  $("mark-rejected").disabled=!storedReady()||!["borrador","enviado"].includes(state.current.status)||state.busy;
  try{
    const q=buildSnapshot();
    $("subtotal").textContent=moneyARS(q.subtotalMinor);
    $("total").textContent=moneyARS(q.totalMinor);
  }catch(e){
    $("subtotal").textContent="—";$("total").textContent="—";
    if(state.lines.length)message(e.message,true);
  }
  renderQuotes();
}
async function refreshQuotes(){
  if(!currentPerson()){state.quotes=[];render();return;}
  state.quotes=await state.api.quotes(currentPerson().id);
  render();
}
function newQuote(clearPatient=false){
  state.current=null;state.lines=[];state.dirty=false;state.pendingRequest=null;
  if(clearPatient)$("patient").value="";
  $("discount").value="0";$("validity").value="7";
  $("line-name").value="";$("line-price").value="";$("line-quantity").value="1";$("catalog-select").value="";
  message("");
  render();
}
function loadQuote(id){
  const quote=state.quotes.find(q=>q.id===id);
  if(!quote)return;
  state.current=quote;state.pendingRequest=null;state.dirty=false;
  $("patient").value=quote.person_id;
  state.lines=quote.items.map(l=>makeLine({name:l.name,quantity:Number(l.quantity),unitMinor:Number(l.unit_minor)}));
  $("discount").value=String(Number(quote.discount_minor)/100);
  $("validity").value=String(quote.validity_days);
  message("");render();
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
    const requestId=state.pendingRequest||(state.pendingRequest=crypto.randomUUID());
    const result=await state.api.save({
      ...(state.current?{id:state.current.id,expectedUpdatedAt:state.current.updated_at}:{}),
      personId:currentPerson().id,items:quote.lines,discountMinor:quote.discountMinor,
      validityDays:Number($("validity").value),requestId
    });
    state.pendingRequest=null;state.dirty=false;
    await refreshQuotes();
    loadQuote(result.id);
    message("Presupuesto "+(state.current?.status==="borrador"?"guardado":"actualizado")+" correctamente.");
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
    const id=state.current.id,expectedUpdatedAt=state.current.updated_at;
    await state.api.status({id,status:next,expectedUpdatedAt});
    await refreshQuotes();
    loadQuote(id);
    message("Estado actualizado: "+next+".");
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
  });
  $("copy-feedback").textContent="";
  $("share-dialog").showModal();
}
function populatePeople(){
  $("patient").innerHTML='<option value="">Seleccioná un paciente</option>'+
    state.people.map(p=>'<option value="'+escape(p.id)+'">'+escape(p.display_name)+'</option>').join("");
}
function mountEvents(){
  $("new-quote").addEventListener("click",()=>newQuote());
  $("patient").addEventListener("change",()=>{newQuote();runBusy(refreshQuotes);});
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
    const {api,tenant,role}=await connectQuoteCloud(window.supabase);
    state.api=api;state.tenant=tenant;state.role=role;
    const [people,catalog,services]=await Promise.all([api.people(),api.catalog(),api.services()]);
    state.people=people;state.catalog=catalog;state.services=services;
    populatePeople();renderCatalog();mountEvents();
    $("catalog-admin").hidden=!["owner","admin"].includes(role);
    $("workspace").hidden=false;
    $("bootstrap-message").hidden=true;
    newQuote();
    if(!people.length)message("Primero cargá un paciente desde la agenda CITHELA.");
  }catch(e){
    bootstrapMessage(e.message||"No se pudo cargar Presupuestos.",true);
  }
}
initialize();
