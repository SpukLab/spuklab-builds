# CITHELA — Auditoría previa al piloto (2026-10-04)

**Alcance:** aplicación web CITHELA, esquema/RPC de Supabase, Storage, pruebas supervisadas en iPhone/iPad y personalización visual. No es una prueba de penetración, ni certifica cumplimiento legal, ni sustituye un ensayo con usuarios reales.

## Estado ejecutivo

**Apto para continuar en un piloto controlado de demostración. No habilitar todavía un piloto externo con información clínica real.** Los flujos cloud de reserva, confirmación, reprogramación, cancelación, historial, señas y borradores de WhatsApp se probaron con el usuario en dos dispositivos. La nueva identidad visual pasa las pruebas simuladas; falta la prueba real tras el despliegue.

### Comprobaciones técnicas verificadas

- **Reserva y concurrencia:** la tabla `cithela_appointments` tiene una restricción PostgreSQL GiST `cithela_appointment_no_overlap` por tenant/recurso/intervalo sobre turnos pendientes y confirmados. La creación desde el portal toma bloqueo sobre el establecimiento y captura colisiones `exclusion_violation`. Los comandos del profesional también bloquean el tenant y controlan `row_version`.
- **Portal del paciente:** `cithela_private.patient_portal()` devuelve fichas de `cithela_patient_links` vinculadas al usuario autenticado y establecimientos activos; sin sesión responde `unauthenticated`. La nueva respuesta incluye únicamente el tema y la ruta pública del logo de ese establecimiento.
- **Señas:** se conserva la distinción entre seña pendiente, verificada, eximida y devolución registrada. Abrir WhatsApp no marca una transferencia como cobrada; la verificación requiere selección de medio y confirmación humana.
- **Identidad visual:** cuatro temas enumerados, configuración con control de versión y rol `owner/admin`. Los logos se almacenan en un bucket público exclusivo de imágenes de marca (PNG/JPEG/WebP, máximo 512 KB); Storage limita inserción, consulta administrativa y borrado al tenant y rol autorizados. El cliente valida tamaño, tipo y firma inicial y rechaza rutas de otro tenant. Sin cambios de reservas ni credenciales bancarias.
- **Privacidad técnica:** las alertas y la información voluntaria del paciente no se interpolan en los borradores supervisados de WhatsApp.
- **Pruebas de personalización en esta rama:** sintaxis JS de `index.html` válida; 14 verificaciones simuladas de temas, aislamiento de URL, permisos y guardado; 11 verificaciones simuladas de formato y carga de archivos, sin subir ni modificar ningún logo real.
- **Observaciones Supabase:** las tablas `cithela_patient_invites` y `cithela_patient_links` mantienen RLS sin políticas de acceso directo. Esto debe preservarse si los datos se gestionan únicamente mediante RPC autorizadas; la advertencia informativa del linter no implica por sí sola exposición.

## Bloqueantes para operar con clientes reales

1. **Separar el modo de demostración (P0).** El HTML público todavía contiene `PASS='1234'` para el antiguo acceso profesional local; la información del modo local se guarda en `localStorage` y no se sincroniza con la nube. Mantenerlo solo para pruebas explícitas o deshabilitar su acceso en el despliegue comercial, con una vía de exportación para quien tenga datos locales. No utilizarlo para fichas reales.
2. **Información personal y roles (P0).** El paciente puede comunicar alergias y sensibilidades. Definir aviso de privacidad, finalidad, responsables, plazo de conservación y un mecanismo para consultar, rectificar y solicitar la eliminación de datos antes de incorporar pacientes reales. Revisar también el permiso de `viewer`: la política actual `cithela_people_member_read` permite leer toda la fila de personas a cualquier miembro del tenant; limitar los campos sensibles a los roles operativos que deban necesitarlos. Hoy el tenant de pruebas tiene únicamente un `owner`.
3. **Prueba real de marca y aislamiento (P0).** Desde la cuenta propietaria, elegir un tema y subir un logo de prueba; comprobar persistencia tras cerrar sesión, visualización en iPhone y en el portal del iPad. Verificar eliminación/reemplazo y rechazo de permisos de un usuario que no sea `owner/admin`. Antes de declarar multitenancy completamente probado, ensayar un segundo tenant con usuarios diferentes y acceso cruzado denegado.
4. **Seguridad de acceso (P0/P1).** El asesor de seguridad de Supabase indica que la protección de contraseñas filtradas está desactivada. Evaluar habilitarla en Auth según disponibilidad del plan; mientras tanto, exigir contraseñas fuertes y únicas o priorizar acceso por enlace mágico verificado. Comprobar cierre y caducidad de sesiones.
5. **Continuidad y comunicaciones (P1).** Realizar una restauración de ensayo de los datos cloud/Storage y documentar la recuperación ante errores. Verificar recepción de enlaces mágicos, invitaciones y operación con conexión intermitente. WhatsApp es manual: el profesional debe revisar y enviar cada borrador; CITHELA no puede afirmar entrega ni lectura.

## Mejoras no bloqueantes

- **Rendimiento (P2):** el linter de Supabase identifica seis claves foráneas sin índice de cobertura y dos índices sin uso observado. Medir volumen y consultar planes antes de incorporar índices o eliminar otros; con el volumen de prueba no constituye un fallo demostrado.
- **UX (P2):** comprobar contraste y presentación de cada paleta, desplazamiento del formulario y logo en pantallas pequeñas; mantener el símbolo CITHELA como marca del producto y usar el logo del establecimiento en sus propios espacios.
- **Nombre público (P1):** el portal toma el nombre del establecimiento de `cithela_tenants.display_name`; el campo local «Nombre del negocio / espacio» no lo modifica. Antes de un piloto comercial, alinear la configuración cloud del nombre público con el logo para que el paciente identifique el negocio.
- **Comercialización (P2):** mantener contratación, organizaciones y suscripciones fuera de la interfaz operativa de CITHELA; incorporar esas funciones más adelante mediante SpukLab Hub.

## Orden recomendado

1. Integrar y verificar identidad visual en iPhone/iPad.
2. Cerrar los bloqueantes P0 de demo local, acceso a datos y privacidad.
3. Ejecutar un ensayo completo con una segunda cuenta/tenant y restauración controlada.
4. Iniciar un piloto acotado con un establecimiento, WhatsApp supervisado y sin cobros automáticos; observar incidencias antes de comercializar a más clientes.

## Referencias de revisión

Código del repositorio `SpukLab/spuklab-builds/cithela/index.html`; migración `cithela/supabase/cithela_tenant_visual_identity.sql`; consultas de restricciones, índices y políticas PostgreSQL; asesores de seguridad y rendimiento Supabase (2026-10-04); capturas y pruebas manuales compartidas por el usuario en esta conversación.
