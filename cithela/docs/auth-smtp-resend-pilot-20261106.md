# CITHELA · SMTP transaccional para el piloto
Fecha de verificación: 2026-11-06. Estado: **procedimiento aprobado para configuración; NO habilitado ni probado en producción**.

## Objetivo

Mantener Meta / WhatsApp como canal primario del paciente; garantizar correo de **confirmación de cuenta profesional, magic link, invitación y recuperación de contraseña**. El servicio integrado de Supabase Auth no sirve para un piloto externo: tiene límite compartido de **2 emails/hora por proyecto** y restricciones de destinatarios. El SMTP es configuración del **proyecto Supabase Auth**, no una variable de Edge Functions, una tabla SQL o un cambio de frontend.

Documentación oficial consultada:
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits
- https://resend.com/pricing
- https://resend.com/supabase
- https://resend.com/changelog/smtp-service

## Proveedor elegido

**Resend, plan Free:** 3.000 emails/mes, hasta 100 emails/día, 3 dominios (consultado 06/11/2026). Sin gasto inicial; la cuota efectiva de CITHELA será el mínimo entre el límite de Resend y el de Supabase (inicialmente 30 emails/hora tras configurar SMTP). No prometer volumen ilimitado. Resend permite SMTP tradicional y no requiere instalar SDK o Edge Functions para emails de Auth.

**Dependencia externa:** disponer de un **dominio propio controlado** (Cloudflare DNS sería adecuado) y de una cuenta Resend verificada. No asumir que `spuklab.github.io`, `workers.dev` o Gmail permiten enviar desde ellos; no son dominios que CITHELA pueda verificar como emisor propio. La web comercial todavía tiene dominio independiente pendiente según `SpukLab-web/docs/CONTINUIDAD.md`. Evitar usar Gmail como dirección `From`.

## Protocolo de activación

### A. Resend / DNS del dominio (acción del propietario)

1. En https://resend.com → **Domains → Add Domain**, agregar un subdominio dedicado de un dominio propio, sugerido: `auth.<DOMINIO-PROPIO>`. No es preciso comprar otra casilla ni hospedar un servidor de correo para enviar.
2. Copiar **exclusivamente** los registros DNS que Resend muestre para ese dominio (SPF/MX de retorno y DKIM, y DMARC según recomendación). En Cloudflare → **Websites → <DOMINIO> → DNS → Records → Add record**, agregarlos con tipo, nombre y contenido exactamente como indique Resend. No inventar valores ni pisar MX/SPF del dominio principal o Cloudflare Email Routing. Si un CNAME fuera requerido, mantenerlo **DNS only**, no proxied.
3. En Resend pulsar **Verify** y confirmar estado verificado. Crear una API key con permiso **Sending access** y, si la cuenta lo permite, alcance del dominio emisor. Nunca subirla a GitHub, ni pegarla en chat o cliente público. El remitente previsto es `no-reply@auth.<DOMINIO-PROPIO>`.

### B. Supabase / proyecto CITHELA (acción del propietario en dashboard)

Abrir https://supabase.com/dashboard/project/mcqknmqhtmihegmifuka/auth/providers (rutas de ajustes pueden cambiar) y navegar por el menú del proyecto **Authentication → Emails → SMTP Settings**; alternativa **Authentication → Settings → SMTP Settings** según versión de la interfaz. Activar **Custom SMTP** e ingresar:

| Campo Supabase | Valor |
| --- | --- |
| Sender email | `no-reply@auth.<DOMINIO-PROPIO>`, mismo dominio verificado |
| Sender name | `CITHELA · SpukLab` |
| Host | `smtp.resend.com` |
| Port | `465` (SMTPS) o `587` (STARTTLS, según formulario) |
| Username | `resend` |
| Password | API key privada de Resend, **solo en Supabase** |

Guardar, sin desactivar la confirmación de email ni abrir alta pública. Comprobar **Authentication → Rate Limits**: límite inicial aprox. 30 emails/hora con SMTP externo; mantener 30/h durante piloto y ajustar más adelante conforme al tráfico, sin superar el plan de Resend ni desproteger el proyecto.

### C. Ensayo controlado de envío y recuperación

1. Con una cuenta de prueba existente, iniciar **recuperación de contraseña** una sola vez. Verificar que el email llega a un destinatario **externo** a los miembros del equipo Supabase, no solo al propietario.
2. Verificar en Resend → **Emails** el estado `Delivered` (no solo `Sent`). Abrir el enlace en Safari, volver a CITHELA con sesión consistente, cambiar la contraseña y autenticar. Evitar repetir pruebas sin necesidad.
3. Con una cuenta profesional de prueba **autorizada** en el onboarding protegido, probar confirmación de correo y recuperación. Si se prueba magic link de paciente, no sustituir la verificación WhatsApp ya validada.
4. Revisar **Authentication → URL Configuration**: Site URL y Redirect URLs deben incluir las rutas exactas autorizadas de CITHELA en GitHub Pages (y dominio propio cuando se publique). No usar comodines amplios sin motivo ni exponer tokens.
5. Repetir en iPhone/iPad: desde Mail a CITHELA y de regreso; revisar Spam y errores Supabase Auth si no llega. Documentar fecha, navegador, correo de prueba parcialmente redactado, tiempo aproximado y `PASS/FAIL`.
6. Mantener **contacto comercial** separado (por ahora `SpukLab@gmail.com` según la web); no interpretar una dirección de salida `no-reply@` como buzón de soporte.

## Protección y seguimiento

- En pantalla de acceso profesional, distinguir «no pertenecés a un establecimiento» de «contraseña incorrecta» sin revelar datos de otras cuentas; no disparar resets automáticos por confusión entre paciente/profesional.
- Mantener límites por IP/usuario, CAPTCHA cuando se abra el registro público, y registro de bounces en Resend. Evitar que unos pocos intentos consuman la cuota compartida de 30/h.
- SPF, DKIM y DMARC correctos antes de publicar. No enviar marketing desde `auth.`.
- No subir tokens/SMTP_PASS a repositorios, logs, capturas, archivos de prueba o al navegador. Rotar claves si se exponen.
- Si aún no se cuenta con dominio, registrar esta dependencia como **bloqueante del piloto externo**. No comprar ni enlazar otro dominio automáticamente.

## Qué se validó / qué NO

Validado: límites y procedimiento en documentación oficial, uso de Supabase Auth en CITHELA, ausencia de configuración SMTP mediante las herramientas de Supabase actualmente conectadas, dependencia de dominio no definida en continuidad web.

Pendiente: alta y verificación efectiva del dominio en Resend; creación de credenciales SMTP; activar configuración Auth desde el panel; ensayo real de envío, entrega, link y retorno de sesión. **Esta PR es exclusivamente documental; no despliega SMTP.**
