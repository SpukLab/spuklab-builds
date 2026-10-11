import test from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, matchService, proposeSlots, draftProposal } from "./whatsapp-slot-proposals.mjs";
test("book, cancel, reschedule and unknown", () => {
  assert.equal(classifyRequest("Hola quiero reservar un turno"), "book");
  assert.equal(classifyRequest("Necesito cancelar mi turno"), "cancel");
  assert.equal(classifyRequest("Quiero cambiar el turno"), "reschedule");
  assert.equal(classifyRequest("Hola"), "unknown");
});
test("service matching is accent-insensitive and not ambiguous", () => {
  const services=[{name:"Coloración"},{name:"Corte"}];
  assert.equal(matchService("Quiero coloracion",services).name,"Coloración");
  assert.equal(matchService("Corte y coloracion",services),null);
});
test("only trusted unique slots; cap three; chronological ordering", () => {
  const slots=proposeSlots([{date:"2026-10-13",slots:["17:00","15:00","15:00","99:99"]},{date:"2026-10-12",slots:["10:00"]}]);
  assert.deepEqual(slots,[{date:"2026-10-12",time:"10:00"},{date:"2026-10-13",time:"15:00"},{date:"2026-10-13",time:"17:00"}]);
  assert.equal(proposeSlots([],{}).length,0);
});
test("date and time preferences restrict rather than invent", () => {
  assert.deepEqual(proposeSlots([{date:"2026-10-13",slots:["10:00","17:00"]}],{requestedDate:"2026-10-13",afterTime:"12:00"}),[{date:"2026-10-13",time:"17:00"}]);
});
test("drafts are not sent or booked", () => {
  assert.equal(draftProposal({name:"Corte"},[]).status,"no_slots");
  assert.equal(draftProposal(null,[]).status,"needs_service");
  assert.equal(draftProposal({name:"Corte"},[{date:"2026-10-13",time:"17:00"}]).status,"awaiting_choice");
});
