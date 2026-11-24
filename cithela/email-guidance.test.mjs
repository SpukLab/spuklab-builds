import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(name)=>readFileSync(new URL("./"+name,import.meta.url),"utf8");
test("inicio profesional explica cómo encontrar correo y recuperación",()=>{
  const s=read("index.html");
  assert.match(s,/id="professional-mail-guidance"/);
  assert.match(s,/Spam \/ Correo no deseado/);
  assert.match(s,/Promociones/);
  assert.match(s,/evitá pedirlo repetidamente/);
  assert.match(s,/resetProfessionalPassword\(email\)/);
});
test("portal público tiene ayuda localizada para email en español e inglés",()=>{
  const s=read("reservar.html");
  assert.match(s,/emailExplain:'Abrí el enlace/);
  assert.match(s,/emailExplain:'Open the email link/);
  assert.match(s,/Spam\/Junk/);
  assert.match(s,/Spam y Promociones/);
});
test("alta autoservicio mantiene verificación y muestra consejos visibles",()=>{
  const s=read("alta-autoservicio.html");
  assert.match(s,/id="email-delivery-hint"/);
  assert.match(s,/id="verify-email-code"/);
});
test("ningún cambio desactiva confirmación ni agrega SMTP en navegador",()=>{
  const s=read("index.html");
  assert.match(s,/resetProfessionalPassword\(email\)/);
  assert.doesNotMatch(s,/smtp_pass|SUPABASE_SERVICE_ROLE_KEY/);
});
