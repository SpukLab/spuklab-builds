# CITHELA internacional · EN-US + SMS (primer incremento)

**Estado 15/11/2026:** rama de prueba, no desplegada. En español el comportamiento normal se conserva. La interfaz inglesa es **parcial** y el SMS está **limitado a un borrador manual**, sin envío por servidor.

## Lo que se implementó

- Selector **ES / EN** en acceso, Ajustes profesional y portal del paciente. Preferencia local e idioma detectado desde `?lang=en` / idioma navegador.
- Etiquetas principales de sesión, agenda, pacientes, turnos y navegación del paciente en inglés, más los botones principales generados dinámicamente dentro del portal del paciente (reservar, confirmar, reprogramar, cancelar), algunos campos de reserva y estados. La traducción se aplica solo a etiquetas conocidas para no reescribir nombres ni datos del paciente. Esto **no es una traducción completa** de formularios, diálogos, errores y contenido dinámico. No anunciar producto final en inglés hasta una auditoría integral.
- Botón **Preparar SMS de acceso a turnos** en la ficha profesional, visible únicamente con `?smsPreview=1` y sesión profesional válida.
- Tras generar una **invitación vinculada al correo del paciente**, aparece **Preparar SMS con enlace de correo**. El paciente sigue confirmando su cuenta a través del flujo de correo existente; el SMS solo lleva el enlace.
- Diálogo de SMS con destinatario visible, consentimiento afirmado manualmente, texto revisable, copiar y abrir aplicación de mensajes con URL `sms:+E164?body=...` (RFC 5724). **El profesional debe realizar el envío desde su teléfono**.
- En los textos de SMS no se incluyen diagnóstico, tratamiento, monto ni historia clínica. Se rechazan números que no estén en formato internacional y dominios ajenos al enlace público de CITHELA.
- No se cambian Auth, la configuración actual de OTP por WhatsApp, la base Supabase, la agenda, el bot de WhatsApp o el historial.

## Distinción imprescindible: tres capacidades diferentes

| Capacidad | Estado |
|---|---|
| Enviar acceso a CITHELA por SMS *desde el teléfono del profesional* | Preparado en rama, revisión humana obligatoria |
| Paciente accede a la web desde el enlace SMS | Funciona **solo con sus credenciales o invitación por correo**; este módulo no crea autenticación SMS |
| SMS automáticos, recepción de respuesta, STOP, OTP exclusivamente SMS | **Pendiente** de proveedor, registro legal, webhook y pruebas |

La invitación de **teléfono** existente es exclusiva del canal WhatsApp y no debe enviarse por SMS diciendo que verificará un código SMS: fallaría su verificación.

## EE. UU. — alternativa de menor costo

**Opción inmediata para probar la demanda:** redactar SMS manualmente desde el móvil del profesional. CITHELA no contrata números ni cobra envíos. La operadora móvil del profesional puede cobrar SMS.

**Servicio automatizado eventual** (para que pacientes respondan vía SMS, se procesen mensajes y se recuerden turnos):
- Número estadounidense del negocio, remitente identificado, consentimiento documentado por paciente, registro de exclusión y respuesta STOP/HELP.
- Para números locales de 10 dígitos, registro **A2P 10DLC** de la marca y campaña, incluso para un negocio pequeño. Un toll-free también requiere verificación, no es una salida sin requisitos.
- Proveedor candidato **Telnyx**: costo de referencia anunciado de **USD 0,004 por segmento** de SMS, más cargos de carriers, número y registro, según volumen/ruta.
- Alternativa **Twilio**: SMS estándar estadounidense desde **USD 0,0083 por segmento**, más cargos de carrier, número y registro. Para casos HIPAA, la contratación elegible y un BAA requieren condiciones adicionales; no basta con tener la API.
- Registro referencial 10DLC de bajo volumen: tarifa de marca en torno a USD 4,50, evaluación de campaña USD 15 y cargo mensual según campaña. **Verificar precio y elegibilidad del profesional antes de contratar**.

Fuentes (consultadas 15/11/2026):
- https://telnyx.com/pricing/messaging
- https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges
- https://www.twilio.com/en-us/sms/pricing/us
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- https://www.twilio.com/docs/iam/twilio-editions/hippa
- https://www.hhs.gov/hipaa/for-professionals/faq/are-appointment-reminders-allowed-under-hipaa-without-authorization/index.html

## Seguridad / privacidad

Para consultorios de EE. UU., tratar nombres y descripciones de tratamientos, diagnóstico e historial como potenciales datos protegidos. SMS no es un canal cifrado. Mostrar solo mensajes neutrales y enviarlos tras consentimiento y selección de canal. Para cualquier integración con proveedor que procese PHI, evaluar obligaciones HIPAA y acuerdos BAA; evitar que los webhooks registren datos sensibles en logs.

No automatizar SMS sin un opt-in demostrable por destinatario y establecimiento, mecanismo de exclusión STOP/HELP, límites de envío, control de costos, validación de firma webhook, deduplicación, separación multi-tenant y monitoreo.

## Próximos incrementos

1. Traducir **todo** el flujo de profesional y paciente en inglés (formularios dinámicos, reservas, notificaciones, estados, errores y horarios), no solo etiquetas principales. Tests en inglés y locale/timezone por establecimiento, evitando convertir fechas entre Argentina y EE. UU.
2. Validez del acceso y OTP: elegir autenticación por correo + SMS de enlace (sin coste API) o OTP SMS directo con proveedor antes de ofrecer un onboarding sin email.
3. Proveedor SMS adaptado con interfaz `channel=whatsapp|email|sms` y adaptador por establecimiento. Nunca mezclar los webhooks existentes de WhatsApp con SMS.
4. Línea/registro estadounidenses y pruebas reales de entrega, respuesta STOP/HELP, privacidad y costos, solo con aprobación y datos del establecimiento.
5. Piloto controlado; no integrar por defecto en todos los profesionales hasta validar el uso real.

## QA

```bash
node --test cithela/international/locale-sms.test.mjs cithela/international/integration.test.mjs
node cithela/international/browser-smoke.cjs # requiere Playwright y Chromium
```

La ruta de prueba de la rama es `cithela/index.html?lang=en&smsPreview=1`. No significa que haya sido publicada.

## Decisión técnica sobre OTP de EE. UU.

En producción existe el hook `cithela-whatsapp-otp` de Supabase Auth. Es un **Send SMS Hook** en nombre, pero su transporte real usa **Meta WhatsApp**, no la red SMS. Es global para autenticación por teléfono y no incluye necesariamente un `tenant_id` confiable en el payload. **No convertirlo a SMS por país de manera unilateral:** una persona con prefijo +1 puede usar WhatsApp y una misma identidad puede estar relacionada con varios establecimientos.

Por ahora, EE. UU. usa:
1. **Cuenta por correo existente** y acceso web seguro compartido manualmente por SMS; o
2. **Invitación vinculada al correo** compartida por SMS, con verificación final por correo.

Para disponer de OTP por SMS sin correo y respuestas SMS bidireccionales, diseñar previamente: identidad y establecimiento del emisor, opt-in documentado, proveedor y número verificado, canal solicitado de manera explícita, verificación de callback/autenticidad, exclusiones STOP, límites por empresa, revocación y auditoría. Nunca basar la seguridad solo en el prefijo +1 ni en un parámetro de URL controlado por el paciente.

### Riesgo comercial adicional

El módulo **Presupuestos** de la PR #155 almacena importes en **ARS**, no USD. Antes de ofrecer ambos a un consultorio estadounidense, agregar moneda por establecimiento (USD) y formatos correctos; también validar zonas horarias de cada profesional. No reutilizar importes argentinos en documentos para pacientes estadounidenses.

### Proveedores (no contratados)

- **Telnyx:** opción de benchmark por precio inicial y tarifas por uso; el número estadounidense, campaña, carrier y vetting suman gastos.
- **Twilio:** alternativa con documentación y SMS API madura; para tráfico con PHI en clínicas, Twilio especifica edición Security/Enterprise y BAA; no asumir elegibilidad HIPAA ni precio común sin cotizar.
- La API SMS no se contrata hasta tener titular del negocio estadounidense, localidad/número deseado, tipo de entidad legal, consentimiento para campañas, volumen y presupuesto aprobado.
