# Acceso profesional por WhatsApp y diagnóstico de correo — 11/11/2026

## Cambios preparados

- `acceso-whatsapp.html`: ruta de prueba controlada para vincular un número a un profesional autenticado o ingresar con un número ya vinculado.
- Reutiliza Supabase Auth y el hook firmado `cithela-whatsapp-otp` desplegado (Meta directo). La petición usa el canal interno `sms`, que el hook entrega por WhatsApp. No se agrega Twilio.
- Vinculación mediante `updateUser({phone})` y `verifyOtp(type:'phone_change')`, comprobando el mismo UID antes y después y la membresía profesional bajo RLS. No crea una identidad nueva para una agenda existente.
- Ingreso mediante `signInWithOtp` con `shouldCreateUser:false`, CAPTCHA compartido y comprobación posterior del teléfono verificado y la membresía. Un usuario sin membresía profesional no recibe acceso desde esta ruta.
- Sin cambio de permisos, RLS, cupos, reservas, tablas, duración de prueba ni sesiones administrativas. El ingreso no crea establecimientos.
- Consentimiento antes de cada envío solicitado, bloqueo de doble clic y espera local de 60 segundos entre solicitudes. Los límites de Auth son los controles efectivos del servidor: la espera local no es una cuota de gasto ni sustituye límites de proveedor.
- Se conserva el acceso por correo/contraseña y la sesión persistente; no se cobra un código por navegar o volver a la agenda.

## Alcance y puertas pendientes

**Esto implementa ingreso/vinculación para cuentas profesionales existentes. No implementa todavía el alta de una agenda nueva usando solo teléfono.** La admisión, las invitaciones y `bootstrap_tenant` exigen actualmente email confirmado. Generalizar esa identidad requiere una migración coordinada y pruebas de concurrencia, caducidad, presupuesto y duplicados por teléfono; no se inventan correos ni se autoconfirman usuarios para sortear esa condición.

La autorización pública continúa OFF. Prueba real pendiente: desde el mismo contexto de Safari que tiene abierta Tattoo INKER, abrir `acceso-whatsapp.html`, vincular el propio número, verificar código, volver a agenda y comprobar identidad; después cerrar la sesión profesional, solicitar un nuevo código y volver a la misma agenda. Si el número ya pertenece a otra cuenta, detener la vinculación: no fusionar ni reasignar cuentas automáticamente. No cerrar ni modificar la sesión administrativa.

230 pruebas Node aprobadas (incluye ocho casos de acceso/vinculación y uno de código de correo). Se intentó la revisión automatizada de navegador, pero el entorno impide iniciar Chromium y no tiene WebKit instalado; no se declara validación de Safari ni E2E con un código real. Ningún mensaje real se envió desde pruebas automatizadas.

## Correo: evidencia y siguiente prueba

- Registro de Hotmail creado 10/11 a las 21:31 ART; Auth `/signup` devolvió 200 y `user_confirmation_requested`; no se observaron errores Auth en la ventana revisada.
- El usuario comprobó el mensaje original en Gmail Enviados al destinatario exacto. No se confirmó entrega automática a Hotmail ni hubo aviso de devolución informado.
- Prueba manual sin enlace desde la cuenta CITHELA llegó. El reenvío del original desde Denis también llegó y su enlace verificó el email; se creó Tattoo INKER y el usuario validó la agenda en iPhone.
- Estas evidencias no permiten atribuir el fallo a un filtro concreto, a una IP ni al enlace. Gmail Enviados y `confirmation_sent_at` no certifican entrega al buzón del destinatario.
- SMTP visible: activado, `smtp.gmail.com`, 465, remitente/usuario CITHELA. No cambiar credenciales ni puerto sin evidencia.
- Preparado un formulario para verificar el código del email mediante `verifyOtp(type:'email')`, sin conceder autorización por el cliente.
- Preparada plantilla sin enlace en `commercial/email-confirm-code.html`; **no está aplicada a Supabase**, porque el conector no expone actualización de configuración Auth. Es una prueba de entrega, no una solución demostrada.

### Aplicación de la plantilla, por el titular

Supabase → CITHELA → Authentication → Emails → Templates → Confirm sign up.
Guardar antes una copia del asunto y cuerpo actuales para rollback. Asunto propuesto: `CITHELA: código de verificación`.
Reemplazar el cuerpo por:

```html
<h2>Verificá tu correo en CITHELA</h2>
<p>Ingresá este código en la pantalla donde creaste tu cuenta:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:5px">{{ .Token }}</p>
<p>Si no solicitaste una cuenta, ignorá este mensaje. No compartas el código.</p>
```

Guardar. Comprobar con un correo de prueba nuevo autorizado y controlado por el titular; no volver a registrar Tattoo INKER ni reenviar desde el buzón emisor para declarar éxito. El código se introduce en alta-autoservicio → «Mi correo incluye un código de verificación». Esta modificación afecta la confirmación de nuevas cuentas en todo el proyecto: los flujos antiguos que solo aceptan enlaces no deben usarse durante la prueba. Restaurar plantilla anterior si no se completa.

Si el correo sin enlace tampoco llega, se necesitan trazas del proveedor/receptor; considerar un proveedor transaccional con eventos de entrega y dominio autenticado, con costo y configuración evaluados antes de contratar. No cambiar automáticamente de proveedor ni abrir altas públicas.
