# CITHELA · Formularios por servicio (v1)

**Estado: prototipo funcional aislado, sin persistencia ni usuarios reales.** Trabajo en PR borrador. No se modifica `cithela/index.html`, Supabase, el portal de pacientes, reservas ni Mercado Pago.

## Por qué este módulo

CITHELA **ya dispone** de una ficha multirrubro en cloud (`cithela_people` con nombre, teléfono, correo de contacto, notas internas, consideraciones y nota voluntaria del paciente), historial de citas y edición con control de versión. Esta fase **no debe crear un segundo directorio ni duplicar fichas**.

Lo pendiente es permitir a cada establecimiento construir cuestionarios opcionales por servicio. El principio de producto es **administración liviana para distintas actividades**, no una historia clínica electrónica ni una receta digital.

## Entregado y verificable

Abrir `cithela/formularios/index.html` con un servidor estático local o, tras publicar expresamente, desde una dirección de previsualización.

- Escenario ficticio de **peluquería**, **tatuajes** o **consultorio**; cambio de servicio dentro de cada establecimiento.
- Crear borrador con título, agregar/quitar hasta 15 preguntas, marcarlas como obligatorias, usar texto breve, texto largo, selección única (2–12 opciones) o confirmación.
- Publicar **solo en memoria** y completar la vista previa como cliente ficticio.
- Validación de requeridos, tipos, opciones, límites de caracteres, borradores no publicados, versión obsoleta, rol simulado y aislamiento de establecimiento/servicio.
- Textos del usuario se insertan en el DOM mediante `textContent`, no HTML; no se hace `fetch`, no se usa `localStorage`, no hay acceso a la sesión ni a bases de datos.
- El resultado simulado expone únicamente un resumen sin respuestas. Al actualizar la página se pierden los cambios.

Los roles de este prototipo **no constituyen autorización**: son una demostración de las reglas que el servidor deberá comprobar.

## Contrato futuro de backend (NO implementado)

Relaciones existentes: `cithela_tenants`, `cithela_tenant_memberships`, `cithela_services`, `cithela_people`, `cithela_appointments`.

Diseño sugerido (nombres provisionales, sujeto a revisión de esquema y legal):
- `cithela_private.form_templates`: `id`, `tenant_id`, `service_id`, `title`, `version`, `status`, `schema_json`, `created_by`, `updated_at`. No permitir reasignar `tenant_id`.
- `cithela_private.form_submissions`: `id`, `tenant_id`, `form_id`, `form_version`, `person_id`, `appointment_id` (opcional), `response_json`, `submitted_at`, `submitted_by`, `consent_version`; referencias por tenant en todas las relaciones. No exponer directamente al Data API.
- Reglas: owner/admin crean y publican; operador puede ver solo si está autorizado explícitamente; paciente accede únicamente a su propio formulario publicado, mediante cuenta verificada y vinculación a `cithela_patient_links`. El enlace público de reserva **no** permite ver respuestas.
- RPC con `auth.uid()`, membresía verificada en base y chequeos de establecimiento/servicio/persona. Idempotencia en envíos, control de versión en ediciones, auditoría **sin copiar respuestas**.
- No utilizar `user_metadata` como fuente de autorización. Probar accesos entre dos tenants y dos personas con JWT reales.
- Definir ciclo de vida, retención, acceso, descarga, corrección y eliminación antes de guardar información de personas reales; no aceptar adjuntos en esta versión.
- **Sin datos de salud:** una ficha administrativa o una pregunta libre no constituye historia clínica; deshabilitar recolección de información clínica sensible hasta tener revisión específica.

## PRs posteriores

1. **Backend:** modelado privado, RPC, seguridad, controles de versión y pruebas de RLS en entorno de prueba. No ejecutar SQL en producción por este PR.
2. **Integración profesional:** `Pacientes/Clientes → Ver ficha → Formularios` y `Configuración → Servicios → Formularios`, reutilizando la identidad actual.
3. **Envío controlado:** formulario previo al turno en portal verificado, consentimiento apropiado, historial vinculado y mecanismo de acceso/caducidad. WhatsApp/SMS solamente como **canal de enlace**, sin respuestas sensibles en mensajes.
4. **Piloto:** validar peluquería/tatuaje con datos ficticios primero, revisar privacidad y retención antes de habilitar clientes reales.

## Verificación

```bash
node --test cithela/formularios/form-model.test.mjs cithela/formularios/isolation.test.mjs
```

Checklist manual en iPhone y escritorio:
1. Elegir peluquería / coloración, crear formulario y preguntas. Cambiar a tatuajes: no debería verse el anterior.
2. Publicar, completar la vista previa y confirmar que faltantes y opciones inválidas se rechazan.
3. Recargar: el borrador y las respuestas desaparecen. No se modificó una reserva, cliente o dato real.

## Relación con otros trabajos

No interviene en la integración Mercado Pago, obra social/prepaga, presupuestos, recetas ni odontogramas. Tampoco modifica el flujo vigente de reserva y atención.
