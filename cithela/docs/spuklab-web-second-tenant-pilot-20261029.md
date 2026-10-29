# CITHELA → SpukLab Web · Preparación del segundo establecimiento
Fecha de corte: **29/10/2026** · Estado: **PREPARADO / prueba de aislamiento pendiente**.

## Estado comprobado en Supabase (solo lectura, 29/10/2026)

- 1 establecimiento `cithela_tenants`, 1 membresía de operador, 3 fichas y 14 reservas.
- Las 15 tablas públicas `cithela_*` tienen Row Level Security (RLS) habilitado.
- Las políticas de lectura para establecimientos, turnos, personas, horarios, servicios y recursos requieren una membresía válida para el **mismo** `tenant_id` y `auth.uid()`; la tabla de membresías permite ver solo las propias.
- `cithela_channel_connections`: lectura restringida a `owner/admin` del tenant. `cithela_channel_inbox` y `cithela_channel_requests` tienen denegación explícita; `cithela_channel_outbox`, `cithela_patient_links` y `cithela_patient_invites` carecen de políticas directas y quedan denegadas por RLS (administración mediante RPC bajo controles específicos).
- No hay funciones `SECURITY DEFINER` de CITHELA alojadas directamente en `public`; las funciones privilegiadas internas están en `cithela_private`, con wrappers públicos.
- `cithela_private.bootstrap_tenant` autentica con `auth.uid()`; crea tenant, rol owner, servicio y recurso inicial cuando el usuario todavía no tiene membresía; si ya tiene una, devuelve `workspace_exists`. **Una segunda organización de prueba necesita una segunda cuenta de operador independiente.**
- Restricción de no-superposición por tenant/recurso para reservas activas. Índice de búsqueda de miembros por usuario y unicidad de teléfono **por tenant**.
- Advisor de seguridad: aviso `auth_leaked_password_protection` deshabilitado; antes de ofrecer contraseñas comerciales, revisar disponibilidad y protección. Los avisos informativos de tablas sin políticas **no** implican acceso libre.
- Estas comprobaciones son de configuración, **no** equivalen a una prueba de aislamiento con dos sesiones reales.

## Objetivo del ensayo A/B

Probar dos comercios independientes **A** (piloto actual) y **B** (nuevo establecimiento de prueba) sobre la misma infraestructura sin duplicar bases ni mover datos de pacientes. No usar información clínica real para el ensayo.

### Preparación manual del establecimiento B

1. Utilizar un **correo/identidad profesional diferente** al owner de A. Confirmar el correo del nuevo operador; el correo de prueba de Supabase tiene cuota limitada. Ingresar como profesional y crear un workspace **solo una vez** mediante el flujo normal `bootstrap_tenant`.
2. Configurar nombre público, logo, color, servicio con duración, un recurso, semana de trabajo y días bloqueados. Registrar un teléfono de prueba autorizado.
3. Entrar con el operador de A en un navegador y el de B en otro (o en perfiles/sesiones separadas). Nunca compartir sesiones ni tokens.

### Comprobaciones de aislamiento obligatorias

| Control | A | B | Aceptación |
|---|---|---|---|
| Agenda y disponibilidad | Agenda A | Agenda B | Cada sesión ve únicamente reservas y horarios propios |
| Pacientes y búsqueda | Pacientes A | Pacientes B | Ninguna búsqueda revela personas del otro tenant |
| Servicios y recursos | Configuración A | Configuración B | Duraciones, nombres y permisos independientes |
| Identidad visual | Logo/paleta A | Logo/paleta B | Portada CITHELA intacta; branding de cada negocio aislado |
| Invitaciones y OTP | Invitación A | Invitación B | El código enlaza únicamente la ficha correspondiente |
| Turnos y señas | Reserva A | Reserva B | Ninguna operación cambia el estado del otro tenant |
| WhatsApp | Mensaje de A | Mensaje de B | Borradores por tenant; no confundir remitente/identidad |
| Intentos cruzados | IDs de B bajo sesión A | IDs de A bajo sesión B | **Acceso denegado** en RPC y lectura directa autorizada |
| Sesión / permisos | Salir de A | Mantener B | Cerrar una sesión no altera los datos ni la otra cuenta |
| Doble reserva | Dos solicitudes al mismo recurso y hora | Independiente | Bloquea superposición intratenant; no bloquea horarios entre tenants |

**Método para la prueba cruzada:** usar sesiones autenticadas reales, llamadas API/RPC con IDs ajenos y verificar respuesta denegada, **sin intentar modificar registros reales**. Incluir dos resultados: lectura RLS y operación RPC. No ejecutar pruebas de cambio/borrado sobre datos de producción.

### Evidencia mínima de aprobación

Guardar fecha, versión desplegada de CITHELA, cuenta de operador de prueba (identificador interno, sin secretos), nombre de tenant A/B, dispositivo/navegador, acción y resultado. Capturas sin teléfonos completos, tokens, enlaces mágicos, notas privadas ni OTP. Marcar cada caso PASS/FAIL; un único cruce de datos es bloqueante.

## Contrato SpukLab Web / Hub (mínimo)

**SpukLab Web** presenta productos, precios, demostraciones y formularios de contacto; más adelante permite onboarding comercial. **CITHELA** sigue siendo la aplicación operativa y propietaria de turnos, pacientes, servicios y permisos.

- **Público:** catálogo CITHELA/DAHZEA, contacto comercial, descripción del servicio y planes. No exponer fichas ni turnos en SpukLab Web.
- **Separación de identidad:** el Hub relacionará `organization_id` / `subscription_id` / `product` con el `tenant_id` creado en CITHELA, mediante contrato server-side idempotente; no confiar en pagos declarados por frontend.
- **Acceso:** redirigir al establecimiento correcto con sesión propia. No incrustar credenciales administrativas ni secretos de Meta/Supabase en GitHub Pages.
- **Soporte:** canal único de contacto; nunca pedir OTP ni enlaces privados a pacientes. Registro de soporte separado de datos clínicos.
- **Marca:** CITHELA como producto, establecimiento como identidad visible para sus pacientes.
- **Costos:** medir usuarios, envíos OTP, mensajes de negocio, almacenamiento, cuota de emails, funciones y uso de Supabase antes de fijar tarifa. Mantener presupuestos estimativos separados de facturación real.

## Bloqueantes comerciales todavía abiertos

1. **Aislamiento A/B:** probar con segundo tenant y usuarios independientes; el chequeo estático de RLS no alcanza.
2. **Autenticación de producción:** SMTP propio o correo transaccional confiable para respaldo; validar WhatsApp de producción, destinatarios, aprobaciones Meta y costos. Un número de prueba de Meta no habilita destinatarios arbitrarios.
3. **Privacidad y permisos:** aviso de tratamiento de datos, retención, rectificación/borrado; revisar acceso a notas sensibles para roles `viewer` y otros.
4. **Modo demo:** separar el acceso local legado y su clave estática del acceso profesional comercial.
5. **Operación:** respaldo/restauración cloud probados, soporte y procedimiento de recuperación, observación de fallos y seguimiento de cuotas.
6. **Comercial:** condiciones del servicio, facturación, cancelaciones, pagos y gestión de suscripciones. No implementar cobro automático todavía.

## Decisión de alcance

**Ahora:** mantener estable el piloto vigente, abrir **un** segundo tenant controlado y aprobar el protocolo A/B.

**Después:** construir la primera SpukLab Web informativa y conectarla mediante links seguros a las apps; automatizar altas, cobros y facturación solo tras validar el aislamiento y los costos.

Referencias internas: `spuklab-hub-commercial-contract-20261011.md`, `pilot-readiness-audit-20261004.md`, `whatsapp-rollout.md`.
