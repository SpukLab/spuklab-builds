# CITHELA · Ficha profesional reorganizada (22/11/2026)

## Qué mejora
La ficha **Cloud existente**, abierta desde `Clientes/Pacientes → Ver ficha`, ahora distingue:
- **Próximos turnos**: reservas futuras con estado pendiente o confirmado, empezando por la más cercana.
- **Historial de turnos**: atendidos, ausentes, cancelados y reservas que ya ocurrieron, con fechas y estados originales.
- **Información y notas**: datos compartidos, consideraciones del servicio, notas internas y formulario de edición existente.
- **Acceso de la persona**: invitaciones por WhatsApp o correo, plegadas para disminuir desplazamientos.
- Resumen de cantidades calculadas sobre lo consultado y próximo turno destacado.

## Reutilización sin migración
No crea un segundo directorio ni modifica `cithela_people`, `cithela_appointments`, `cithela_patient_links`, sesiones o el portal de pacientes. Usa **`CithelaCloud.personHistory(id)` existente**, que ya filtra por tenant/persona y limita los turnos recuperados a 50.

Las cantidades de la vista **NO son totales históricos del establecimiento**: reflejan únicamente hasta 50 turnos devueltos. El símbolo «+» informa cuando se alcanzó el límite de la consulta, no certifica que existan turnos adicionales.

Se conserva `cloudSavePersonProfile`, `cloudIssuePhoneInvite`, `cloudIssueInvite`, `openPatientWhatsApp` y `ntStartForPerson`, con sus identificadores y controles de sesión vigentes. No cambia permisos existentes. Las notas y el acceso paciente quedan en paneles plegables, pero **plegar contenido no equivale a restringir acceso**.

## Relación con formularios pendientes
- #186 — editor de formularios en memoria.
- #187 — SQL de plantillas, pendiente de pruebas y **no aplicado**.
- #189 — demo profesional → cliente → ficha con respuestas ficticias.
- #201 — biblioteca de formularios por actividad.

Este PR no consulta ni muestra **respuestas reales**. Cuando el backend cuente con aislamiento y permisos verificados, la entrada `Formularios` podrá agregarse al modal existente, con RPC específica, sin ampliar indiscriminadamente `personHistory()`.

## Validación
- `node --test cithela/cloud-person-profile-groups.test.mjs`
- `node --test cithela/person-intake-ux.test.mjs`
- Regresión automatizada existente de UX y sesiones.

**Pendiente:** inspección visual real de iPhone/iPad/escritorio y prueba manual con una ficha ficticia en ambiente de ensayo. No fusionar antes de revisar esos puntos.

## Fuera de alcance
No toca Mercado Pago, contrataciones, calendarios, coberturas, formularios persistentes, historias clínicas ni taxes de EE. UU. El futuro módulo USA Taxes deberá montarse como especialización de servicios y fichas, con reglas de privacidad propias, sin añadir documentos fiscales al directorio general.
