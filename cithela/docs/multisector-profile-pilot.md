# CITHELA · Ficha multirrubro y piloto de peluquería

## Campos y acceso
| Dato | Quién lo edita | Quién lo consulta |
|---|---|---|
| Nombre, WhatsApp E.164, correo de contacto | Personal autorizado del establecimiento | Personal con acceso a la ficha |
| Información compartida (opcional, revocable mediante borrado del campo) | Paciente/cliente desde el portal seguro; en demostración local el operador puede registrarla | Personal con acceso a la ficha y la persona que la compartió |
| Consideraciones del servicio (legado `alerts`) | Personal autorizado | Solo personal con acceso a fichas |
| Notas internas (legado `notes`) | Personal autorizado | Solo personal con acceso a fichas |
| Correo de acceso Supabase | Proceso separado de autenticación | La cuenta autenticada |

El correo de contacto no actualiza `auth.users.email`, las invitaciones previas ni el vínculo de acceso. No se añade información compartida, consideraciones ni notas internas a los borradores de WhatsApp.

La ficha cloud rechaza sobrescrituras si otro dispositivo cambió `updated_at` desde la carga. El portal guarda exclusivamente la nota del propio usuario vinculado, sin habilitar la edición de notas internas. Todos los cambios escriben eventos de auditoría sin copiar el contenido de las notas.

Las columnas actuales `alerts` y `notes` se conservan por compatibilidad, con etiquetas multirrubro. El campo `patient_shared_note` está separado y es voluntario. Los archivos adjuntos siguen siendo solo de la demostración local: **no están provisionados en cloud**.

## Validación piloto — peluquería
1. Crear un espacio separado del de pruebas con la cuenta profesional de la peluquera; configurar **Actividad: Peluquería**, término **Cliente**, nombre comercial, servicios (corte/coloración), duración real y horarios. No reutilizar la ficha de prueba de otro establecimiento.
2. Registrar un cliente de prueba con un WhatsApp que controlen y un correo de contacto. Desde **Clientes → Ver ficha → Editar datos y notas**, cambiar el número; verificar que el recordatorio abra el número nuevo y que el correo de acceso no cambie.
3. Con una cuenta de cliente vinculada, abrir el portal y escribir una nota voluntaria no sensible, como “Prefiero una cita por la mañana”. Guardar y confirmar que la profesional puede leerla, pero no aparece en el borrador de WhatsApp.
4. Verificar el rechazo de un número duplicado, de un formato de teléfono incorrecto y de una edición sobre una ficha desactualizada.
5. Probar una reserva, confirmación, reprogramación y cancelación entre dos dispositivos. Verificar que el historial de la agenda conserve los registros anteriores.

## Límite de esta fase
Los datos internos son visibles para los miembros del espacio con acceso a fichas (owner/admin/operator); todavía no existen permisos granulares por campo ni una política de conservación y eliminación de información sensible. Antes de usar CITHELA con historiales médicos o datos sensibles reales, definir consentimiento específico, roles, minimización de datos, almacenamiento, retención y revisión legal/técnica aplicable. Evitar recopilar información médica no necesaria durante el piloto de peluquería.
