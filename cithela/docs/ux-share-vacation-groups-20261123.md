# CITHELA · Acceso rápido a reservas y ausencias agrupadas

**Revisión UX — 23 de noviembre de 2026**

## Cabecera del profesional

- **Enlace de turnos** accesible bajo el encabezado de cualquier pestaña profesional. Solo aparece si la cuenta Cloud autenticada tiene permiso y el servidor confirma una URL pública válida para el establecimiento activo.
- Acciones directas: **Copiar**, **Compartir** (Share Sheet de iOS, con copia como alternativa) y **QR** (abre la pantalla existente de enlace y código).
- No se genera ninguna URL por concatenación ni se usa una dirección de reservas de otra cuenta. Se reutiliza `professionalBookingShare()`, la validación de origen y el control `owner/admin/operator`.
- No se revela información al cerrar sesión: se invalida el estado y se oculta la sección.
- En **Ajustes** queda la categoría **Reservas → Idioma de las reservas y coberturas**, separada de **Agenda y atención**. Ya no se repiten los botones de compartir.
- Se eliminó del texto de Ajustes el enlace promocional **«Vincular mi WhatsApp para ingresar»**. **Ingresar con WhatsApp** sigue disponible como alternativa diferenciada en el ingreso profesional y continúa exigiendo un número previamente vinculado. No se modificó la autenticación ni el flujo del portal de pacientes.

## Vacaciones / ausencias largas

- Los tramos Cloud ya creados (de hasta seis días) se presentan como **una sola ausencia** cuando están contiguos, tienen el mismo motivo y recurso y se registraron en un intervalo de 10 minutos. El modelo se limita a períodos de hasta 90 días; los datos antiguos o individuales siguen visibles como antes.
- La agrupación es **solo visual**. Cada tramo conserva su UUID en Supabase. No hay migración ni nueva tabla.
- En la entrada agrupada se puede **Ver tramos individuales** (y quitarlos uno por uno), o **Quitar período** con confirmación explícita.
- La eliminación del período ejecuta los comandos `availability_block.delete` existentes, secuencialmente y **solo para owner/admin**. Revalida establecimiento, permisos, UUID y fechas antes de cada paso. Si hay error parcial, se informa cuántos tramos se eliminaron; los demás siguen bloqueados.
- Los turnos existentes **no se modifican ni cancelan**. Quitar un período podría volver a ofrecer horarios para nuevas reservas; por eso exige confirmación.

## Verificación

- `cithela/availability/block-groups.test.mjs`: agrupa 7 tramos de 40 días; no combina recursos, motivos ni creaciones distintas; no modifica datos.
- `cithela/availability/block-remove.test.mjs`: eliminación confirmada, cancelación, autorización, ID incorrecto y error parcial.
- `cithela/ux-ergonomics.test.mjs` y `cithela/ux-browser-smoke.cjs`: cabecera con acciones y ajustes de reservas separados, en 320/390/768/1280 px.
- Regresiones existentes de Cloud y de sesiones.

**Pendiente antes de uso real:** comprobar en Safari físico la agrupación y la función «Quitar período» en una cuenta interna. Esta PR no elimina ningún bloqueo actual durante la publicación.

## Fuera de alcance

Sin modificaciones de Supabase/RLS, Mercado Pago, comprobantes, impuestos de EE. UU., autenticación OTP, invitaciones de pacientes ni documentos sensibles.
