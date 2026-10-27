# CITHELA — Auditoría MVP comercial · 2026-10-27

**Estado: PILOTO CONDICIONADO.** No se certificó operación externa ni se tocaron tablas, usuarios, credenciales, storage o funciones desplegadas. Inspección sobre `SpukLab/spuklab-builds` `main` @ `717162527ffa95fd2b2a98dce280275015110cd6` y Supabase `mcqknmqhtmihegmifuka`.

## Evidencia comprobada

- Plataforma actual: GitHub Pages estático (`cithela/index.html`), Supabase Auth/Postgres/RLS/Realtime/Storage, Edge Functions para WhatsApp. Render aloja DAHZEA, **no** el backend de CITHELA.
- Proyecto Supabase `ACTIVE_HEALTHY`, 31 migraciones registradas y 4 Edge Functions `ACTIVE`: `cithela-whatsapp-webhook`, `-otp`, `-review` y `-send`.
- Datos reales preservados, sin exponer identidad: 1 tenant, 1 membership, 1 recurso, 2 personas, 3 servicios, 11 tramos semanales, 9 turnos: 3 pendientes, 2 confirmados y 4 cancelados.
- **SQL de integridad ejecutado en producción en modo lectura:** cero pares de turnos activos superpuestos, cero intervalos inválidos y cero versiones inválidas. La exclusión GiST `cithela_appointment_no_overlap` y checks de duración están instalados. Esto no prueba por sí solo carreras reales ni comportamiento de la UI.
- **RLS:** en 15 tablas públicas CITHELA está habilitado. `anon` no tiene SELECT en esas tablas. Acceso `authenticated` SELECT sólo según RLS; los INSERT están denegados directamente. Tres tablas (outbox, patient invites, patient links) no tienen políticas explícitas; esto **no es una filtración** con sus grants actuales. Revisar si cambian las exposiciones.
- **Riesgo de minimización:** `cithela_people_member_read` entrega toda la fila a cualquier miembro del tenant, incluido `viewer`, mientras `index.html` solicita `notes, alerts, patient_shared_note`. Hay un solo miembro en la base; el riesgo existe en la arquitectura de alta de nuevos roles, no está comprobado un acceso indebido actual.
- Realtime publica citas, personas, servicios, recursos, horarios y bloqueos; el cliente suscribe esos eventos, reconsulta tras 400 ms y usa refetch de respaldo cada 45 s / visibilidad. **No** hay prueba independiente de pérdida, duplicación ni desconexión desde dos navegadores.
- Catálogo en la base con duraciones múltiples de 15 minutos y grilla lunes-viernes mañana/tarde, sábado mañana. Los comandos y cálculos de disponibilidad están del lado servidor, no sólo en HTML.
- WhatsApp: webhook desplegado con verificación HMAC SHA-256 y comparación constante; `review`/`send` verifican JWT y rol owner/admin. Las tres funciones que ya estaban versionadas se compararon contra sus contenidos desplegados y coincidían. **Faltaba en repositorio el código del webhook**: esta rama copia su `index.ts` directamente desde versión desplegada 13, sin modificación, secretos ni despliegue.
- Tránsito WhatsApp: inbox 14 filas `new`; outbox 3 `sent`, 8 `unknown`. `sent` indica aceptación de API, no entrega/lectura. `unknown` requiere conciliación manual con Meta; **no reintentar automáticamente** mensajes potencialmente enviados.
- Teléfono OTP en la web: `CITHELA_PHONE_OTP_ENABLED=false`. El funcionamiento de envío/recepción de la Cloud API de WhatsApp **no** demuestra funcionamiento del OTP del paciente. Para el piloto, mantener vía email probada con condición de comprobar entregabilidad real/limitaciones SMTP.
- GitHub Actions: suites Node sobre paciente, orquestación, propuesta de horarios, OTP y WhatsApp. Run de revisión WhatsApp `40424512152` y Pages `40424511973` exitosos para el head; el último run localizado de patient email pilot `38819119317` es del 15/10, anterior al head. Estos son tests de código/mocks/sintaxis, **no** pruebas integrales de login, navegadores y API de Meta.
- Rendimiento: sin métricas reales de navegación iPhone; asesor Supabase indica 9 FK sin índice y 6 índices sin uso, sólo información de optimización, no caída comprobada.

## Priorización y remedios verificables

| Nivel | Hallazgo / riesgo | Corrección mínima | Aceptación |
|---|---|---|---|
| **P0 — antes de clientes externos** | Datos personales, roles `viewer`, privacidad y retención | Limitar nuevas altas a owner/operator autorizados; acordar aviso, campos personales mínimos, plazo y proceso de rectificación/borrado. Diseñar política de lectura mínima para `viewer` **sin romper agendas** | Usuario viewer de laboratorio sin acceso a notas/alertas; owner ve agenda; cliente acepta aviso |
| **P0** | Multitenancy sin ensayo cruzado: hay 1 tenant y 1 membership | Segundo tenant y usuarios ficticios en staging; ensayar select/RPC/edge de tenant A contra B | Cero lectura/escritura cruzadas; suspendido no opera |
| **P0** | Recuperación sin restauración ensayada | Backup privado consistente de Auth-vínculos, filas, esquema, configuración y Storage (en este momento bucket de marca vacío); restauración en entorno aislado | Turnos, servicios, permisos y accesos preservados; procedimiento y fecha |
| **P0** | Acceso de paciente por mail condicionado al proveedor / OTP WhatsApp deshabilitado | Probar entrega de email externo, doble dispositivo, link caducado, recuperación; no activar OTP sin template AUTH aprobado + verificación del hook | Login, reserva, cancelación y reingreso en Safari/Chrome o contexto soportado |
| **P0** | Prototipo local públicamente accesible con `?demo=1` y PIN fijo, persistido en localStorage | Retirar del producto comercial o aislarlo en URL/demo separada; nunca guardar allí datos reales | URL comercial sólo admite sesiones cloud; sin pérdida de datos de los testers |
| **P1** | `refresh()` carga como máximo 500 citas ordenadas desde la más antigua | Diseñar carga paginada por rango de calendario; preservar historial en consultas separadas | Crear fixtures de más de 500 turnos en staging; mes actual y futuro completos |
| **P1** | `refresh()` elige sólo la primera membership (`.limit(1)`) | Mantener 1 tenant/cuenta para el primer piloto; antes de multiespacio crear selector con persistencia segura | Usuario de laboratorio asociado a 2 tenants alterna sin fuga |
| **P1** | Outbox `unknown` y inbox `new` | Vista operativa clara para revisar, sin afirmar entrega y sin reenvíos automáticos | Operador identifica cada caso y Meta confirma resultado |
| **P1** | Correo/mensajes y cambios en paralelo no probados recientemente E2E | Matriz guiada desde iPhone/iPad/PC; pruebas de bloqueo y cancelación simultánea | Sin dobles reservas; versión obsoleta rechazada, recarga correcta |
| **P1** | Código webhook no versionado | **Corregido en esta rama** copiando exactamente fuente de producción; agregar test funcional y despliegue versionado antes de evolución | Igualdad de contenidos fuente/live y CI para cambios futuros |
| **P1** | Nombre de establecimiento público / datos locales vs cloud | Separar claramente campos cloud y datos del prototipo; revisar que nombre/logo visibles correspondan al tenant | Cuenta nueva muestra su propia marca en dos dispositivos |
| **P2 — después del piloto** | Índices secundarios, UI responsive extrema y optimización | Medir tiempos reales, consultar planes con EXPLAIN antes de indexar | p95 real medido, lista de consultas lentas |
| **P2 — posponer** | Odontograma, señas automáticas, bot que toma turnos solo, módulos de cuidados, modelos IA | Mantener fuera del alcance del piloto | Core de turnos comercial y atendible |

## Alcance de pruebas y resultados

- **EJECUTADAS — read-only:** conteos de tablas, roles/grants/RLS, constraints (incluida exclusión GiST), disponibilidades semanales, relación de publicaciones Realtime, inventario de Edge Functions y comparación de 3 fuentes versionadas con desplegadas. Invariantes SQL = **PASS** (0 superposiciones, 0 intervalos malos, 0 row_version inválidas).
- **CI CONSULTADO — PASS:** último run encontrado de WhatsApp supervised review y publicación GitHub Pages sobre `7171625`. No ejecutar envío real por esta auditoría.
- **NO EJECUTADAS — pendientes:** dos navegadores reservando a la vez, dos tenants, dos roles, OTP/SMTP real, restauración, funcionamiento visual en iPhone, latencia p50/p95 en red móvil, tests de carga. El origen GitHub Pages no pudo abrirse en el navegador disponible para esta auditoría; el CI de Pages no prueba por sí solo render ni UX.

Consultas reutilizables: `cithela/supabase/mvp_pilot_readonly_checks.sql`. Ejecutarlas de nuevo luego de cada migración pertinente.

## Protocolo de cambios

1. Antes de migrar/desplegar, tomar respaldo **privado fuera del repositorio público**, verificar que incluya datos y esquema, registrar SHA GitHub, versiones Edge, y procedimiento de rollback. No escribir un dump con datos de pacientes en PR, Issues, logs o CI.
2. Crear cambios en rama y PR, nunca push directo a `main`; ejecutar suites, tests de SQL y E2E en staging. La política/roles no se debe improvisar modificando RLS en producción con usuarios conectados.
3. Piloto inicialmente 1 establecimiento + responsable owner, servicios, agenda y pacientes con invitación por mail; WhatsApp sólo supervisado. Sin reservas automáticas desde mensajes ni pagos online.
4. Lanzar después de superar P0 con registro de fecha, versión, incidencias, recuperabilidad y plan de soporte.

**No se hicieron INSERT, UPDATE, DELETE, ALTER, cambios de Auth/Storage, despliegues Edge ni commits sobre main.** Este documento no equivale a una certificación de seguridad, cumplimiento legal ni prueba E2E.
