# CITHELA — reserva de consultas con obra social / prepaga

**Estado:** prototipo funcional, datos inventados, PR aislada sobre `main`. No se ha fusionado ni conectado a Supabase. La agenda vigente no se modifica.

## Corrección del producto

La selección de obra social o prepaga debe estar disponible **antes del día y horario**, desde la propia selección del servicio. Presupuestos (PR #155) cubre tratamientos, procedimientos y estimaciones posteriores, pero no sustituye el precio de la consulta de agenda.

Flujo futuro en `cithela/reservar.html`:
1. Selección de servicio y profesional
2. Particular / obra social / prepaga → entidad → plan
3. Mostrar **precio orientativo**, seña aplicable o «Importe a confirmar»
4. Selección de día y horario, email verificado, solicitud pendiente
5. Profesional confirma el turno y, si corresponde, valida afiliación/plan/autorización por sus canales

Las coberturas se configuran por **tenant + servicio + entidad + plan**. Nunca deducir precio a partir del nombre del plan ni aplicar el precio particular como copago. Ante ausencia, doble configuración o vencimiento: **importe a confirmar**. Diferenciar precio de consulta, seña (actualmente `cithela_services.deposit_amount_minor`) y presupuesto de tratamiento (PR #155).

## Profesiones y ejemplos

- **Odontología:** consulta odontológica, control; algunos planes podrían tener aranceles particulares, copagos o requerir autorización
- **Medicina:** consulta inicial o control; convenios y planes opcionales
- **Psicología:** entrevista inicial o sesión; permitir particular y planes, sin incorporar motivos clínicos ni diagnóstico al selector público
- **Otros rubros:** no mostrar por defecto un selector sanitario; catálogo y reservas siguen iguales

Cada establecimiento puede elegir aceptar o no determinada entidad. El menú de cobertura no implica que una obra social esté validada ni que el paciente sea afiliado.

## Entregado en esta PR

- `index.html`: prototipo interactivo de reserva para tres tipos de establecimiento con datos **ficticios** y sin envío al servidor.
- `admin.html`: prototipo editable de **Configuración → Servicios → Precios y coberturas**, con elección de establecimiento, servicio, particular/obra social/prepaga, entidad/plan, precio orientativo o «a confirmar», vigencia, edición, desactivación/reactivación y vista previa de lo que vería el paciente. Las modificaciones **solo existen en memoria mientras la página está abierta** y se reinician al cambiar el rol/establecimiento.
- `catalog-editor.mjs`: simulador de permisos owner/admin vs operator, aislamiento por tenant, rechazo de duplicados y revisión de versión para evitar sobrescribir cambios; esto **no sustituye la autorización server-side**.
- `catalog-editor.test.mjs` y `admin-ui.test.mjs`: pruebas de la lógica del editor, formato monetario, permisos simulados, ausencia de datos personales y llamadas a servicios.
- `coverage-rules.mjs`: lógica pura para resolver **importe orientativo** con coincidencia exacta y cierre seguro ante ambigüedad, ausencia o caducidad.
- `sample-data.mjs`: tres establecimientos ficticios y ejemplos numéricos inventados.
- `coverage-rules.test.mjs`: pruebas de separación por tenant, servicios, planes, precios vencidos, no heredar precio particular y requisitos de confirmación.
- `integration.test.mjs`: garantiza que el prototipo no recopila datos reales ni activa reservas.

## Diseño de backend antes del piloto

**No implementar cobro ni mostrar precios de la demo como tarifas reales.**

Se requiere una implementación server-side revisable e inactiva por defecto:
- `health_booking_enabled` por establecimiento, sin deducir permisos de una cadena de texto «actividad»
- Catálogo de prestadores/planes aceptados editado por owner/admin, con vigencia y versión de convenios
- Tarifas por servicio-entidad-plan, moneda ARS, estado «orientativo» o «a confirmar», auditoría de cambios y bloqueo de sobreescrituras concurrentes
- RPC de lectura pública devuelve SOLO reglas publicadas de establecimientos con reservas habilitadas, sin identificadores de pacientes, afiliaciones, notas, diagnósticos ni historia clínica
- Al crear reserva, el servidor verifica nuevamente tenant, servicio, plan y versión de la tarifa y guarda un snapshot de la **modalidad y el precio orientativo seleccionado** asociado a esa solicitud. El cliente nunca envía su propio importe como autoridad. La afiliación se verifica fuera del formulario público o mediante una futura integración autorizada
- Permisos por rol, RLS y pruebas con JWT real entre dos establecimientos
- Si cambia un convenio entre la lectura y la reserva, servidor devuelve conflicto para reevaluar tarifa, no confirma un importe obsoleto
- Estado del turno pendiente hasta confirmación profesional, sin envío de WhatsApp/SMS ni débito a paciente

**Privacidad:** el hecho de asociar una especialidad o una cobertura con una persona podría constituir dato de salud. Aplican medidas reforzadas de seguridad, consentimiento, finalidad y minimización según Ley argentina 25.326. No habilitar con pacientes reales hasta revisión de protección de datos, condiciones, roles y retención (https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion). Para entornos estadounidenses, evaluar HIPAA según actividad y entidad; no declarar cumplimiento.

## Siguiente paso verificable

La pantalla de **Configuración → Servicios → Precios y coberturas** ya está diseñada como simulación local. El siguiente trabajo pendiente es implementar el **RPC real de administración**, los permisos por servidor, la persistencia y la lectura pública segura de convenios y tarifas. **No fusionar ni aplicar SQL a producción** sin las pruebas end-to-end y privacidad. La integración eventual en `reservar.html` debe incluir feature flag apagado y regresiones sin cambio de comportamiento en peluquería.
