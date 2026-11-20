# CITHELA · Respuestas antes del turno — flujo independiente (PR apilado)

**Estado:** prototipo funcional de flujo en memoria, sin usuarios, base, cobros ni mensajes reales. Esta rama depende de `feat/cithela-formularios-multirubro-v1-20261120` (PR #186). La propuesta de plantillas persistentes está aparte en PR #187.

## Qué se puede probar

Abrir `cithela/formularios/flow-preview.html` servido desde un origen estático que permita cargar módulos JavaScript (no con doble clic a `file://` en navegadores que bloquean módulos).

1. **Profesional:** seleccionar entre peluquería y estudio de tatuajes, elegir un servicio y preparar una solicitud de ejemplo vinculada a una persona/turno sintéticos.
2. **Cliente:** responder un cuestionario de 3 campos; el modelo valida preguntas obligatorias y tipos. La persona es ficticia y no existe autenticación en esta maqueta.
3. **Ficha:** ver las respuestas exclusivamente en memoria desde el rol profesional simulado. Cambiar de servicio crea una solicitud nueva; cerrar o recargar borra todo.

En el prototipo se representan: estado pendiente/enviado, vencimiento de 48 horas, revocación modelada en la capa pura, control de versión, reintento idempotente con las mismas respuestas y aislamiento por tenant/persona a nivel de funciones.

**No debe presentarse como un sistema ya seguro para pacientes**. Los controles JavaScript son ilustrativos; cualquier persona con acceso al navegador de demostración puede inspeccionar su estado en memoria.

## Lo que ya existe en CITHELA

- Directorio `public.cithela_people` con teléfono, email de contacto, notas y `patient_shared_note`.
- Vínculos autenticados `public.cithela_patient_links (tenant_id, person_id, user_id)`.
- Reservas `public.cithela_appointments`, con relaciones compuestas por `tenant_id`.
- Catálogo `public.cithela_services` con relación `unique (tenant_id,id)`.
- Registro de eventos operativo sin necesidad de registrar contenidos de respuesta.

No duplicar estas estructuras ni reescribir la agenda. Un servicio puede tener varios turnos; una solicitud de formulario pertenece a una persona y opcionalmente a **un turno del mismo establecimiento y servicio**.

## Contrato backend para la integración futura (NO implementado)

### 1. Plantillas

PR #187 propone `cithela_private.cithela_form_templates` y RPC solo de dueño/admin. Debe testearse con JWT reales en base aislada antes de aplicarse; conserva las versiones publicadas y no debe permitir editar retrospectivamente un formulario respondido.

### 2. Solicitudes

Tabla privada sugerida `cithela_private.cithela_form_requests`:
- `id`, `tenant_id`, `template_id`, `template_version`, `service_id`, `person_id`, `appointment_id` opcional, `status` (pending/submitted/revoked), `expires_at`, `created_by`, `created_at`, `submitted_at`, `revision`.
- FK tenant+service, tenant+person, tenant+appointment; validar en servidor que appointment tenga **el mismo person_id y service_id**.
- Snapshot de la versión de campos publicado al emitir la solicitud (si el formulario se archiva, la respuesta debe continuar siendo interpretable).
- `request_id` estable para reintentos; unicidad/idempotencia por tenant+actor+solicitud; bloquear registro durante finalización transaccional.
- Caducidad impuesta usando reloj **servidor**, no por fecha enviada por el cliente.

### 3. Respuestas

Tabla privada, separada de plantillas, nunca publicada al Data API:
- `tenant_id`, `request_id`, `person_id`, `form_version`, `answers_json`, `submitted_at`, `submitted_by`, `consent_version`, con un único envío por `request_id`.
- Solo cuenta verificada vinculada a la persona (`auth.uid()` + `cithela_patient_links`) puede leer preguntas vigentes y enviar; nunca confiar en `person_id` del navegador.
- Solo personal del establecimiento con permiso explícito a **formularios** puede consultar respuestas; no asumir que todos los operadores deban ver datos sensibles.
- No incluir respuestas, teléfonos, diagnósticos o notas en auditoría, logs, enlaces ni borradores de mensajes.
- Reintento idéntico devuelve éxito sin duplicar; reintento distinto se rechaza y exige un nuevo flujo.
- **No pedir historia clínica, diagnósticos ni otros datos sensibles** en versión general. Los campos libres pueden contener datos de salud; faltan evaluación de privacidad, finalidad, consentimiento, controles, retención y borrado seguro.
- No generar enlace público adivinable ni permitir lectura anónima: usar portal seguro ya autenticado. WhatsApp/SMS solo trasportarán una invitación neutra sin respuestas.

### 4. Habilitación por etapas

- [x] Maqueta profesional → cliente → ficha, sin red ni persistencia.
- [x] Test de modelo para tenant, persona, vencimiento, reintentos y control de versión.
- [ ] Integrar con backend del PR #187 tras revisión y pruebas aisladas.
- [ ] Diseñar/implementar RPC de solicitudes/respuestas en DB de pruebas, con JWT reales, RLS y auditoría.
- [ ] Revisar permiso del operador, derecho de acceso/corrección/borrado y política de retención.
- [ ] Integrar pestaña `Servicios → Formularios` y `Clientes/Pacientes → Ver ficha → Formularios`.
- [ ] Probar en iPhone/iPad/escritorio y habilitar gradualmente, primero con datos sintéticos.

### Validación

```bash
node --test cithela/formularios/form-model.test.mjs cithela/formularios/isolation.test.mjs cithela/formularios/flow-model.test.mjs cithela/formularios/flow-isolation.test.mjs
```

El flujo de Mercado Pago es otro conjunto de PRs y **no interviene** en este módulo.
