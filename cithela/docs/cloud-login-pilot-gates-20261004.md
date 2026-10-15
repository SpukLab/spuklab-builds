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


## Actualización: autenticación por WhatsApp · 15/10/2026

El piloto **ya validó** en dispositivos reales: acceso del paciente por correo, reserva cloud, reprogramación, cancelación y actualización visible en el iPad profesional. Safari conserva su sesión; abrir desde la vista de Mail o desde otro contexto de navegador puede usar una sesión distinta. El SMTP incorporado de Supabase bloqueó nuevos correos mediante `over_email_send_rate_limit`.

### Objetivo final (separar chat de autenticación)

1. El profesional da de alta/invita al paciente con teléfono E.164 propio del paciente, seleccionado y verificado antes de asociar la ficha.
2. El paciente abre CITHELA y solicita un código por WhatsApp; no necesita conversar para reservar.
3. Supabase Auth genera OTP, ejecuta **Send SMS Hook** autenticado con Standard Webhooks, y la Edge Function `cithela-whatsapp-otp` envía exclusivamente mediante la API oficial de Meta. El paciente copia el código y lo introduce en CITHELA; Supabase valida mediante `verifyOtp({type:'sms'})`.
4. Solo después de verificar el teléfono y canjear una invitación personal válida (expiración y un único uso) puede acceder a la ficha, los turnos y datos del tenant.

**Integración corregida:** Para usar Meta directamente como transporte mediante el Send SMS Hook, el cliente debe solicitar `signInWithOtp({phone, options:{channel:'sms', shouldCreateUser:true}})`. El `channel:'whatsapp'` nativo de Supabase está reservado a Twilio y Twilio Verify. El destinatario recibe el mensaje **por WhatsApp** igualmente, porque lo envía el hook. Referencias:
- [Supabase: Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
- [Supabase: Phone Login](https://supabase.com/docs/guides/auth/phone-login)
- [Meta: autenticación con botón copiar código](https://www.postman.com/meta/whatsapp-business-platform/request/6vkv46u/create-authentication-template-w-otp-copy-code-button)

**Estado del bloqueo externo:** la cuenta `Test WhatsApp Business Account` (número +1 555, exclusivo de pruebas) devuelve un rechazo explícito al intentar crear la plantilla `cithela_codigo_acceso` de categoría AUTHENTICATION / botón copiar código. La plantilla **no fue creada ni aprobada**. La Edge Function está desplegada, pero la funcionalidad sigue desactivada mediante `CITHELA_PHONE_OTP_ENABLED=false`. No habilitarla ni iniciar envíos reales hasta disponer de WABA autorizada y plantilla APROBADA. No presentar plantillas de utilidad como si fueran códigos OTP.

### Puertas de activación pendientes

- Registrar una **cuenta WhatsApp Business real con número controlado por SpukLab**, distinto del número personal ya utilizado en WhatsApp, o resolver formalmente la restricción de la cuenta actual con Meta. No dar por elegible un número Meta gratuito para clientes externos.
- Crear/aprobar `cithela_codigo_acceso`, idioma `es_AR`, categoría AUTHENTICATION, `COPY_CODE`, y verificar el payload efectivo del botón en Meta. La validez de entrega de 10 minutos se configura aparte de la caducidad efectiva del OTP en Auth.
- En Supabase: Authentication → Providers → Phone (habilitar); Authentication → Hooks → Send SMS (apuntar a `/functions/v1/cithela-whatsapp-otp`, firma Standard Webhooks válida); definir `SEND_SMS_HOOK_SECRET` concordante **sin exponerlo en navegador**, `META_WHATSAPP_OTP_TEMPLATE` y, si corresponde, `META_WHATSAPP_OTP_BUTTON_SUBTYPE`. Comprobar que el token permanente y phone number ID son del emisor autorizado. No activar sin probar el envío.
- E2E de laboratorio: un solo teléfono verificado, destinatario permitido, botón copiar, comprobación de OTP válido/inválido/vencido, límite de reintentos y ausencia de doble cuenta; cerrar y reabrir el navegador para comprobar persistencia.
- **Migración de pacientes existentes:** el perfil ya enlazado por correo pertenece a su `auth.uid()`. Crear otra cuenta de Auth por teléfono no lo autoriza automáticamente a la misma ficha; `patient_invite_redeem` rechaza `already_linked`. Diseñar un enrolamiento verificado de teléfono sobre la identidad existente (o mecanismo administrativo de migración que preserve trazabilidad), sin reasignar la ficha solo por coincidencia de número.
- Luego de superar las pruebas, activar el feature gate en la web; correo se conserva solo como recuperación, preferentemente con SMTP propio. No presentar autenticación por WhatsApp como funcional durante el bloqueo Meta.

**No modificar** secretos o Auth Providers en producción antes de resolver los puntos de Meta y la estrategia de identidad; el acceso ya probado debe permanecer estable.
