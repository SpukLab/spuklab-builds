# CITHELA — UX previa al piloto (04/11/2026)

Estado: cambios propuestos en PR #124. Sin merge a `main` ni modificaciones de datos.

## Cambios de presentación

1. **Agenda profesional**: Confirmar, Reprogramar y WhatsApp/Recordar se mantienen visibles; «Más acciones» despliega Gestionar seña, Atendido, No asistió, Marcar recordado (en modo local) y Cancelar. Los permisos y condiciones originales de cada acción permanecen intactos. No crea confirmaciones de WhatsApp automáticas.
2. **Acceso paciente**: instrucciones breves, botón «Continuar por correo» para email, WhatsApp opcional y cambio de cuenta conservado. Sin alteraciones de Auth ni OTP.
3. **Identidad del paciente**: titular «Establecimiento donde reservás», nombre del negocio tomado exclusivamente de `profile.tenant_name`, y «Tu ficha» junto al nombre correspondiente. Sin suplir nombres o logos de prueba.
4. **Ajustes**: horarios, ausencias y servicios antes del estado comercial; el estado queda en «Cuenta y herramientas». Se conserva la información de vigencia.
5. **Mensajes**: mantener consultas y filtros como pantalla operativa; diagnósticos de Meta trasladados a «Ajustes → Cuenta y herramientas → Infraestructura». Los comandos de conexión y OTP siguen siendo de comprobación y no envían mensajes.
6. **Personalización local**: título explícito «Preferencias locales (solo este dispositivo)» para diferenciar configuración del dispositivo de identidad del establecimiento.

## Pruebas

- `cithela/ux-ergonomics.test.mjs` + `cithela/pilot-ux-20261104.test.mjs` comprueban sintaxis, ausencia de IDs duplicados, acciones de agenda, navegación y jerarquía.
- `cithela/patient-pilot.test.mjs` actualizado para el CTA por correo y el aviso de sesión; no cambia permisos ni funciones.
- `cithela/ux-browser-smoke.cjs` en GitHub Actions cubre 320, 390, 768 y 1280px con Chromium sin Supabase. No certifica Safari.
- La PR debe quedar abierta como borrador hasta completar revisión real desde iPhone/iPad.

## QA manual antes de fusionar

| Caso | Aceptación |
| --- | --- |
| Agenda pendiente | Confirmar, Reprogramar y WhatsApp visibles; abrir «Más acciones» y encontrar seña y Cancelar donde corresponda |
| Agenda confirmada | Sin acción «Confirmar» duplicada; sigue pudiendo reprogramar, cancelar, gestionar señas y registrar atención según fecha |
| Modo local | «Más acciones» mantiene registro manual de recordatorios y cancelación, sin confundirlo con Cloud |
| Acceso paciente por correo | «Continuar por correo» genera el mismo flujo de Magic Link; retorno desde Mail mantiene la sesión |
| Paciente WhatsApp vinculado | No aparecen invitaciones ajenas ni se pierde la ficha al volver |
| Dos establecimientos A/B | El nombre/logo visible del paciente pertenece al tenant correcto; «Tu ficha» identifica a la persona, nunca al negocio |
| Ajustes | Horarios primero, estado del servicio en Cuenta y herramientas; Meta solo dentro de Infraestructura |
| iPhone/iPad/PC | Desplegables y botones visibles, sin scroll horizontal, sin ocultar acciones por teclado o altura |
| Seguridad | Nada de tokens ni datos de pacientes en capturas públicas; probar con datos ficticios |

**Bloqueantes del piloto**: prueba real A/B y RPC cruzada; autorización supervisada; correo transaccional; privacidad y backups. No se habilitan contratación, pagos, purgas ni altas públicas mediante esta PR.

**Recomendación para marketing**: luego de fusionar y validar, obtener nuevas capturas auténticas sin barras del sistema, usuarios identificables, datos telefónicos ni marcas de otros productos. La web SpukLab sigue en PR #21, separada de estos cambios.
