# CITHELA · Reservas públicas (piloto controlado)
Fecha: 15/11/2026

## Implementado
- `reservar.html?c=<slug>`: interfaz pública sin invitación, español/inglés, catálogo activo, elección de fecha y horario, email OTP/magic link con CAPTCHA existente, alta/vinculación segura de ficha del paciente por contacto verificado, reserva idempotente y pantalla de solicitud pendiente.
- `compartir.html`: panel para propietarios/administradores autenticados. Enlace único, identificador modificable, activación por tenant, idioma inicial, QR, copiar, abrir WhatsApp o redactar SMS manual.
- `cithela_public_booking_*`: RPC públicas solo de lectura para catálogo/disponibilidad, escrituras autenticadas por email confirmado; se reutilizan verificaciones transaccionales existentes de agenda, entitlement, citas y doble reserva.
- Configuración de zona horaria IANA: solo owner/admin, únicamente si el tenant no tiene ningún turno histórico; contiene zonas comunes de Estados Unidos.
- Configuración en `index.html → Configuración → Enlace público y QR de reservas`.

## Seguridad, alcance y activación
- **Al desplegar, todos los establecimientos mantienen reservas públicas desactivadas.**
- No hay alta comercial abierta ni cambios automáticos en invitaciones, precios, roles o suscripciones.
- La página pública no devuelve pacientes, datos de contacto, citas previas ni información clínica.
- El paciente verifica su email antes de crear/vincular su ficha y usar el RPC existente de creación.
- **MVP: todo turno nuevo queda pendiente** de confirmación humana, tal como en el sistema previo. No se habilita autoconfirmación hasta ensayar turnos y no-show, señas y cancelaciones.
- El botón SMS usa el cliente de mensajería del dispositivo. No existe envío automático de SMS ni factura de proveedor.
- Las señas de CITHELA continúan en ARS y no se procesan; no anunciar dólares ni cobrar pacientes.
- **No declarar cumplimiento HIPAA** ni lanzar a consultorios estadounidenses con datos médicos hasta revisar contrato BAA, privacidad, hosting, retención y seguridad.
- Limitación: correos que no llegan, Auth redirect/OTP y compatibilidad móvil requieren prueba real con un paciente. El servidor tiene una cuota inicial por establecimiento, pero una protección avanzada contra scraping/abuso necesitará un endpoint perimetral con rate limit.
- Los enlaces se deben activar solo para un tenant de prueba tras validar la agenda, timezone, un correo verificado y una reserva.
- Cambio de slug invalida el enlace anterior; no se incluyen claves privadas ni datos de pacientes en URLs.

## Pruebas ejecutadas
1. SQL completo en BEGIN/ROLLBACK sin errores de sintaxis.
2. SQL aditivo desplegado en Supabase CITHELA. RLS habilitada y sin lecturas directas de tabla.
3. Conteo de configuración tras migración: cero registros, cero cuentas activadas.
4. Catálogo y disponibilidad con slug inexistente retornan `not_found` a clientes anónimos.
5. `anon` no puede invocar vinculación de pacientes; `authenticated` sí, bajo chequeo de email confirmado.
6. RPC de configuración consultada/guardada por propietario real dentro de transacción **revertida**: locale EN persistió dentro de la transacción.
7. Scripts JS de `index.html`, `reservar.html` y `compartir.html` compilan sintácticamente.
8. Pendientes: E2E navegadores reales, entregabilidad Auth correo, pruebas concurrencia y ocupación de turno, validación zona EE. UU., QR, SMS manual.

## Publicación y rollback
- GitHub Pages sigue el `main` de `SpukLab/spuklab-builds`; cambios de HTML deben fusionarse solo luego de revisión de esta PR.
- Base aditiva no interfiere mientras `enabled=false`.
- Para desactivar inmediatamente un tenant, owner/admin puede desmarcar **Permitir reservas desde el enlace**. No borrar turnos ni cuentas existentes.
- Si hubiese incidentes, bloquear todos los enlaces con `update public.cithela_public_booking_settings set enabled=false` (administración técnica), sin tocar reservas previas.
