# CITHELA — Auditoría UX / ergonomía de piloto (2026-10-27)

**Entorno revisado:** `SpukLab/spuklab-builds` (aplicación única en `cithela/index.html`), rama base `main` SHA `9c304e69ff3f7cf712e1dfa9d111f9118649419e`. Evaluación estática del árbol de pantallas, estilos, eventos y rutas de navegación; comparación con la arquitectura verificada de Supabase en auditoría MVP de la misma fecha. **Sin test de usuario ni captura de render real:** la legibilidad efectiva y el comportamiento del teclado Safari requieren comprobarse en iPhone/iPad.

## Recorridos principales

### Profesional
1. **Abrir Agenda.** La fecha/semana es el punto de entrada; se muestran pendientes operativos, turnos activos e historial. El botón primario lleva a crear un turno. El resumen semanal ahora va debajo de la lista operativa.
2. **Buscar una persona.** La búsqueda por nombre, teléfono o correo es visible primero. El alta está en un acordeón «+ Agregar persona», sin ocupar espacio cuando sólo se consulta el directorio. Al guardar, se cierra el acordeón.
3. **Nuevo turno.** Mantiene el flujo de selección persona → servicio/duración → recurso → día → horario, y la consulta de disponibilidad cloud. No se modifican RPC, horarios, buffers, ni transacciones.
4. **Ajustes.** Horarios, bloqueos y servicios al principio; luego identidad/datos/cobros; finalmente conexión/infraestructura/seguridad. Reportes pasa a una subpantalla explícita con regreso a Ajustes.

### Paciente
Conservar portal cloud de «Mis turnos» y reserva autenticada. No introducir nueva jerarquía ni autenticación en esta intervención. El calendario compartido también mejora la navegación de teclado (aunque el portal cloud usa sus propios selectores).

## Hallazgos, gravedad y resolución

| Urgencia | Hallazgo validado sobre código | Cambio en rama UX | Validación pendiente |
|---|---|---|---|
| P0-UX | Viewport bloqueaba ampliación de página con `maximum-scale=1` | Se elimina limitación y se añade `viewport-fit=cover` | Zoom/pellizco y VoiceOver en Safari |
| P1 | Seis pestañas horizontales incluyendo Mensajes compiten por ancho móvil | Cinco pestañas primarias; reportes dentro de Ajustes | 320, 375 y 430 px sin truncar controles |
| P1 | Reportes/diagnósticos se encontraban al mismo nivel que la agenda | Reportes accesible desde Ajustes, conservando los IDs y funciones originales | Exportar CSV y volver a Ajustes sin perder contexto |
| P1 | La agenda abría con estadísticas, dejando turnos por debajo | Nuevo turno visible tras calendario; pendientes y turnos preceden resumen | Un profesional encuentra su turno del día rápidamente |
| P1 | El directorio abría mostrando siempre el formulario de alta | Primero búsqueda, formulario bajo `details` | Guardar, cerrar, buscar y ver ficha |
| P1 | Configuración presentaba primero preferencias poco frecuentes | Orden: horarios/bloqueos/servicios/recursos/recordatorios, negocio/branding/cobros, cuenta/diagnóstico/seguridad | Editar una jornada y volver a la agenda sin alterar reservas |
| P1 | Controles de 30–40 px, notas de 10–11 px y mensajes efímeros largos | 44–48 px para controles móviles; aumenta texto; toasts adaptan ancho y área segura | iPhone SE/14, zoom de fuente, rotación |
| P1 | Días del calendario eran `div onclick`, no controles accesibles | Se cambian a `button` con `aria-pressed` y foco | Teclado, lector de pantalla, selección de fecha |
| P1 | «Backup» local podía confundirse con respaldo de la nube | Mensaje explícito que NO respalda Supabase | Operador reconoce la diferencia |
| P2 | El sitio depende de múltiples valores CSS minúsculos e inlines | Se mitigaron las clases frecuentes en móvil | Auditar contraste, W3C/WCAG 2.2 y tipografía |
| P2 | Tarjetas de persona, estados y secciones extensas | Sin reescribir componentes todavía | Medición de tiempos y tareas reales |

## Cambios implementados en rama

- **Solo** `cithela/index.html`, tests `cithela/ux-ergonomics.test.mjs` y CI `.github/workflows/cithela-ux-ergonomics.yml` más este informe.
- Se conservan identificadores de campos, comandos, permisos, esquema y persistencia.
- Nuevo acceso desde Agenda a «+ Nuevo turno».
- Recuperación visual de Reportes desde Ajustes (reportes siguen siendo el mismo panel).
- Mínimos táctiles y accesibilidad del calendario semanal.
- Reordenamiento estático de 11 detalles de configuración; no migración de datos.

## Verificación de código

- Validación de sintaxis del JavaScript principal, IDs HTML únicos y acordeones `<details>` balanceados (lecturas directas del archivo modificado).
- GitHub Actions `CITHELA UX ergonomic checks`: pruebas sobre estructura, navegación, jerarquía y legibilidad declarada.
- GitHub Actions `CITHELA patient email pilot` y `CITHELA WhatsApp supervised review`: ejecutaron con éxito contra una versión de la rama tras los cambios principales, antes de añadir la suite UX; nuevo PR debe esperar comprobación final para fusionar.
- **No se probó** que 44–48 px sean visualmente cómodos para todas las personas, ni WebKit/VoiceOver, ni escenarios con datos reales. CI verde no certifica experiencia de usuario.
- No se probaron nuevas reservas ni se insertaron filas. No se cambió producción ni la base.

## Matriz de aceptación visual y operativa (manual, antes de merge)

1. **iPhone estrecho (320–375 px):** cinco pestañas legibles con desplazamiento accesible; pestaña Ajustes sin desbordes; semana navegable con el pulgar; permitir zoom; no tapa acciones el teclado.
2. **iPhone 14 (390 px):** crear turno cloud, cerrar formulario/volver a agenda, confirmar/reprogramar/cancelar, estado visible tras sincronización y vuelta desde WhatsApp.
3. **iPad vertical y horizontal / PC:** búsqueda/alta de persona, todas las secciones de Ajustes, reportes y exportaciones. No pierde datos al cambiar de pestaña.
4. **Paciente:** enlace de invitación → sesión → reserva, confirmación/cancelación y regreso a Mis turnos; sin exponer datos locales del demo.
5. **Accesibilidad:** botones de semana accesibles al teclado, zoom, contraste, aumento del tamaño de texto y errores con mensajes persistentes cuando una acción de guardar falle.

## Principio para siguientes iteraciones

**No agregar pantallas ni funciones para corregir densidad visual.** Primero medir (tiempo hasta encontrar un turno, crear una reserva y consultar una ficha); luego corregir sólo puntos de fricción observados. Evitar rediseñar Auth, WhatsApp o migrar datos como parte de un ajuste meramente visual.
