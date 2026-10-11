# CITHELA — Acceso cloud e invitaciones: preparación de piloto

Fecha de revisión: 2026-10-04. Estado: interfaz implementada en rama; pruebas reales entre WhatsApp y correo pendientes. Esta guía no habilita el uso de información clínica real por sí sola.

## Flujo simplificado

**Profesional:** ingresar correo habilitado → solicitar enlace mágico → abrir correo → volver a CITHELA con sesión recuperada automáticamente. La cuenta debe existir y tener una membresía de un tenant activo. Un correo no autorizado no crea una cuenta ni un tenant automáticamente.

**Paciente, primera vez:** el establecimiento emite una invitación desde su ficha y envía un enlace por WhatsApp. Al tocarlo, CITHELA recoge el token y el correo destinatario del *fragmento* de la URL (nunca en los parámetros de consulta). El paciente solicita el enlace mágico para **ese mismo correo**. Al volver autenticado, CITHELA canjea el token en Supabase y abre sus turnos. El canje sigue exigiendo que el correo esté verificado, que coincida con el destino y que la invitación no haya vencido ni sido usada/revocada.

- El enlace de WhatsApp tiene validez de **48 horas** y un solo uso por el control existente de Supabase. Emitir uno nuevo para la misma ficha revoca el anterior.
- El navegador conserva temporalmente el token durante **30 minutos**, lo borra al canjearlo y elimina el fragmento de la barra de direcciones al abrirlo. Si el correo se abre en otra aplicación/navegador, el paciente vuelve a tocar el enlace original desde ese navegador. El código manual queda como alternativa desplegable.
- Una sesión activa de **otro correo** no puede canjear automáticamente la invitación: se ofrece «Cambiar de cuenta».
- Las sesiones ya vinculadas entran directamente al portal sin volver a introducir una invitación.

**Demostración:** los campos y la contraseña heredados del prototipo local se ocultan en la entrada habitual. Solo se muestran con la opción explícita `?demo=1`. Este modo contiene un PIN estático en el HTML público: sirve solo como ejemplo *local sin datos reales*, nunca como autenticación ni autorización cloud. Los datos locales antiguos permanecen en el dispositivo hasta que el usuario los borre o exporte.

## P0 de infraestructura antes de invitar pacientes externos

1. **Correo transaccional:** verificar en Supabase Dashboard → **Authentication → SMTP Settings** si CITHELA ya tiene SMTP personalizado. El SMTP predeterminado de Supabase restringe los destinatarios a las direcciones preautorizadas del equipo, tiene límites estrictos y carece de garantía de entrega. Configurar un proveedor SMTP transaccional (por ejemplo, Resend/Brevo o equivalente), identidad del remitente y dominio verificado; ajustar límites, SPF, DKIM y DMARC según proveedor. No introducir contraseñas SMTP en GitHub, HTML público ni conversaciones. [Documentación oficial](https://supabase.com/docs/guides/auth/auth-smtp).
2. **Redirecciones:** en Supabase Authentication → URL Configuration, validar Site URL y Redirect URLs autorizadas para `https://spuklab.github.io/spuklab-builds/cithela/`, tanto en iPhone como en iPad. Mantener tokens de invitación en fragmentos de enlace del paciente, no en el redirect de Auth, logs o analíticas.
3. **Provisionamiento profesional:** revisar el procedimiento para dar de alta cuentas y memberships en el tenant. El acceso habitual de profesional usa `shouldCreateUser:false`, por lo que usuarios nuevos requieren un alta autorizada antes del primer enlace mágico. La gestión comercial, altas y suscripciones quedará más adelante en SpukLab Hub.
4. **Privacidad:** terminar el aviso al paciente, controlar la visibilidad de notas/alergias por rol, ensayar un segundo tenant con personas distintas y documentar retención/eliminación de información personal. Los comprobantes bancarios siguen sin implementarse.
5. **Resiliencia:** verificar entrega del correo, expiración del enlace, cierre de sesión, recuperación en otro navegador, reserva con dos dispositivos, conflicto de horario, cambios de seña y copia/restauración de los datos cloud y archivos de Storage. La protección de contraseñas filtradas figura deshabilitada en el asesor de Supabase: revisar configuración de Auth si se habilita contraseña como método real.

## Prueba de aceptación del nuevo ingreso (sin datos reales)

1. En el profesional cloud, emitir una **nueva** invitación a un correo de prueba que no pertenezca al equipo de Supabase y enviarla por WhatsApp. Esto revoca la invitación previa de esa ficha.
2. Abrir el enlace desde un navegador sin sesión, confirmar que CITHELA presenta el correo destinatario y ofrece «Enviar enlace mágico», sin pedir que se copie el token.
3. Verificar que el correo llega, abrirlo, volver a la misma aplicación/navegador y entrar a Mis turnos. Si se abre otro navegador, tocar nuevamente la invitación de WhatsApp.
4. Confirmar que intentar abrir esa invitación con otra cuenta no la consume. Comprobar que el acceso posterior a la cuenta vinculada ya no necesita invitación.
5. Cerrar y reabrir CITHELA en el iPhone para comprobar la restauración de la sesión, el mismo tenant y el tema/logo configurados; el login debe mantener la marca del producto y no mostrar datos del prototipo local.

**Estado de validación a la fecha:** comprobaciones de código y flujo simulado superadas; no hay verificación de envío de emails a terceros, acceso real desde WhatsApp ni prueba del segundo tenant. No declarar producción lista antes de completarlas.
