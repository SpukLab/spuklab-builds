# CITHELA · prueba controlada de registro y correo · 10/11/2026

## Evidencia de acceso
Denis confirmó desde Safari que el ingreso administrativo funciona y que Turnstile aparece brevemente. Esto valida ese acceso real; no acredita todavía el alta nueva ni el retorno de correo del autoservicio.

## Recorrido restringido
Administración → Altas autoservicio → Prueba controlada del registro permite autorizar hasta dos correos pendientes, durante un máximo de 48 h. Reutiliza cithela_pilot_invites y su emisión/canje; agrega una marca privada selfservice_test, sin crear otro sistema de invitaciones. No envía mensajes ni crea usuarios de Auth al autorizar el correo.

La persona abre alta-autoservicio.html?prueba=1, crea una cuenta mediante el captcha nativo de Auth, verifica el correo, acepta las condiciones y completa otra comprobación de seguridad para la autorización. test_status y admit consultan el correo confirmado en Auth, nunca un email enviado como identidad por el navegador. El marcador de URL solo habilita la presentación del formulario; no concede grants, tenant, rol ni trial. La autorización y los cupos se comprueban en servidor.

La prueba restringida funciona con enabled=false para el público. Las solicitudes anónimas de disponibilidad continúan cerradas; los usuarios verificados sin una invitación marcada para prueba también quedan rechazados. La marca no sustituye un grant ni amplía el trial: bootstrap existente crea una sola agenda y una prueba de 7 días. Revocación y vencimiento siguen en el sistema de invitaciones actual.

## Comprobaciones
- 220 pruebas Node: permisos, correo normalizado, captcha, cuerpo limitado, formulario de prueba y regreso de usuario verificado.
- 11 pruebas PostgreSQL 17.11 aislado con dos conexiones: cupos diarios/simultáneos, reintentos, bootstrap único, rollback, vencimientos, reserva previa conservada y acceso QA mientras el público permanece cerrado. El fixture mínimo no acredita todo el RLS productivo.
- Migración y Edge instaladas con 0 autorizaciones QA, 0 admisiones, enabled=false. Los 4 establecimientos y 17 reservas existentes se conservan; no se emitieron correos ni se crearon usuarios productivos.

## Prueba pendiente del usuario
1. Recargar Administración y autorizar un correo propio distinto del administrador, que no tenga establecimiento ni invitación previa. No activar Admitir solicitudes automáticas.
2. Abrir el registro de prueba, crear cuenta, confirmar el correo y continuar hasta configurar la agenda. Si el correo abre otra pestaña, el servidor reconoce la cuenta de prueba por su email verificado aunque no esté el parámetro prueba=1.
3. Verificar establecimiento, servicios, horarios y personalización; abrir el profesional y Administración en paralelo. Comprobar con una segunda identidad el aislamiento y los vencimientos antes de abrir el CTA comercial.

## Estado de apertura
El público continúa cerrado. La habilitación general, cobros y purgas no forman parte de esta entrega. No activar CITHELA_SELFSERVICE_ENABLED ni el selector de admisión hasta completar el recorrido y las verificaciones restantes.
