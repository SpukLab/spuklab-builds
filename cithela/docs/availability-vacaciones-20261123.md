# CITHELA — Vacaciones, feriados y cierres de varios días
Fecha: 23/11/2026 · PR para revisión, **sin alterar turnos existentes**.

## Motivo
La ficha profesional actual solo ofrece bloqueos de un día o franjas de 30 minutos. El backend confirmado en Supabase dispone de `availability_block.create/delete`, pero **rechaza un rango superior a 7 días por comando**. Cambiar solamente un date-picker no alcanza.

## Experiencia de usuario
En **Ajustes → Agenda y atención → Ausencias y bloqueos**:
1. **Un día o una franja horaria**: conserva el comportamiento anterior.
2. **Varios días consecutivos**: introducir **Desde** / **Hasta**, ambas fechas inclusivas. Admite de **1 a 90 días** y períodos que atraviesan Navidad, Año Nuevo y otros límites de mes/año.
3. Ingresar motivo opcional (hasta 300 caracteres), revisar el aviso y confirmar.
4. La interfaz divide la ausencia en **tramos de hasta seis días civiles**. Cada tramo tiene ID y comando idempotente independientes para respetar el límite de servidor incluso con cambios de horario de verano. El motor y las verificaciones existentes evitan nuevas reservas; los turnos ya reservados **no se modifican ni cancelan**.
5. Los tramos se muestran en la lista y se pueden **quitar por separado**, con confirmación. No hay botón de eliminación masiva.

## Seguridad y degradación
- No se creó RPC adicional, tabla, migración ni función Edge.
- La autorización se ejecuta de verdad en `cithela_private.configuration_command` a través de `cithela_configuration_command`: actualmente **solo `owner/admin` de establecimientos activos**.
- Sin permisos, la interfaz no permite programar el bloqueo. No es mecanismo de autorización, solo ergonomía.
- Antes de crear, la UI comprueba superposiciones con bloqueos ya cargados, pero la comprobación de base sigue siendo autoritativa.
- Los turnos que aparecen en el estado local se usan solo para advertir de posibles cruces; puede no contener todos los históricos. El texto no afirma que no haya turnos existentes.
- Se confirma expresamente que el bloqueo no cancela turnos. Puede activarse en la misma fecha (el inicio real es unos minutos después de ahora), siempre que no sea un día anterior a la fecha local del establecimiento.
- Las fechas se convierten con la **zona horaria del establecimiento**, no la del teléfono; evita errores para el futuro piloto `America/Denver`.
- Si falla un tramo, **los anteriores permanecen guardados**. Se informa cuántos se grabaron, se ajusta la fecha Desde al primer tramo pendiente y se solicita revisión antes del reintento. No se promete atomicidad ni se realiza un rollback potencialmente destructivo.
- Los bloqueos locales de demostración se representan como un día por entrada, utilizando las reglas ya existentes de disponibilidad.

## Ejemplos para prueba
- Del **24/12/2026** al **04/01/2027** = **12 días**, dos tramos Cloud.
- Del **01/01/2027** al **31/01/2027** = **31 días**, seis tramos Cloud.
- Cambios DST `America/Denver`: un tramo de seis días mide como máximo 145 horas cuando se atrasa el reloj, menor que 7 × 24 h.
- Un período de 91 días debe ser rechazado; una fecha imposible como 29/02/2027 también.

## Precauciones para publicar
- Test Node de fechas, años bisiestos, DST y scripts; test visual Chromium 320 / 390 / 768 / 1280 px con fechas sintéticas.
- **No equivale a prueba física Safari**. Hacer una prueba controlada en un establecimiento de prueba, después de fusionar la PR, antes de usarlo para vacaciones reales.
- La versión propuesta todavía **no incluye recurrencias anuales** (por ejemplo todos los 25/12); es para un período puntual con inicio y fin.
- El backend limita la duración a siete días; si en el futuro se desea guardar una ausencia como una sola unidad reversible, será necesario diseñar un RPC transaccional nuevo, con auditoría y protección multi-tenant.

## Sin relación con
Mercado Pago, suscripciones, cobros, USA Taxes, historias clínicas, envío de SMS ni modificación masiva de reservas.
