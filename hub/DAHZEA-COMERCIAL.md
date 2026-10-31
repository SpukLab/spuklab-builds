# DAHZEA comercial como puerta de entrada de SpukLab
Fecha: 31/10/2026

## Objetivo prioritario

El visitante entra a **SpukLab** y es recibido por **DAHZEA**, que le pregunta qué quiere resolver, identifica si la necesidad corresponde a CITHELA, DAHZEA o SURKARA, presenta el producto y facilita la consulta/solicitud. El catálogo es complementario, no sustituye la recepción comercial.

## Lo implementado en la web estática

- Asistente DAHZEA visible desde la primera pantalla de `hub/index.html`, accesible por `#asistente` y desde las páginas de CITHELA/DAHZEA.
- Recorrido real de botones con preguntas sobre necesidad y tarea; tres recomendaciones y CTAs: ficha del producto y correo comercial previamente rellenado con producto e interés seleccionados.
- **Es una guía determinista, sin LLM ni API**; se identifica así en la interfaz. No simular conversación libre, disponibilidad, pagos o contrataciones.
- No recopila ni almacena correos, nombres, datos de cliente o conversaciones. Sin cookies de marketing, envío de formularios, lecturas de datos operativos ni almacenamiento local. Solo se abre la app de correo cuando el visitante pulsa el CTA.
- SURKARA se presenta expresamente como **en desarrollo**, no disponible para comprar.
- CITHELA y DAHZEA se presentan como **pilotos con incorporación supervisada**, no con checkout ni prueba gratuita de duración no verificada.

## Próxima etapa: conectar el verdadero motor comercial DAHZEA

El motor conversacional actual de DAHZEA opera para el vendedor de Mercado Libre en contexto autorizado. **No conectar su endpoint de operador, sesión, token, almacenamiento ni credenciales de ML directamente al sitio público**. La capacidad comercial debe constituir un ámbito distinto:

`visitante web → DAHZEA comercial (API de sitio público) → catálogo aprobado + políticas → recomendación → solicitud → verificación y alta por el Hub`

Requerimientos del backend:
1. Identidad `spuklab-public-sales` y datos de catálogo separados de tiendas, compradores, credenciales ML y pacientes CITHELA. Sin consultas a inventarios ni registros operativos.
2. API de conversación con sesión pública anónima, límites por IP/sesión, controles de costos, antifraude y no inferencia de información privada. Salida estructurada con `product_id`, `intent`, `recommendation_reason` y `next_action` validados en servidor.
3. El modelo ayuda a comparar productos, pero nunca inventa condiciones, precios, descuentos, stock, prestaciones, disponibilidad del piloto o confirmaciones de alta. El servidor aplica condiciones publicadas y estado de oferta vigente.
4. Una solicitud comercial identificada requiere consentimiento explícito, mínimo dato necesario, retención definida, y un endpoint servidor idempotente. No utilizar `mailto` como registro definitivo de contratación.
5. Para cobrar y activar, una pasarela de pagos verificable y la autorización de Hub ejecutan la transición en servidor; webhooks de pago autenticados, idempotencia, estado verificable y provisión con alcance tenant/producto. Nunca desde texto generado por IA.
6. Pruebas de filtración cruzada: tienda DAHZEA A/B, establecimiento CITHELA A/B, otro producto y visitante anónimo. Un fallo de autorización bloquea publicación.

## Dominio

Cuando se defina el dominio en Cloudflare, se revisan host canónico y origen de la API comercial. GitHub Pages puede continuar alojando la web estática; si se necesita ejecución server-side, evaluar un Worker de Cloudflare o una API aislada en la infraestructura elegida (sin habilitar otra instancia por defecto). Credenciales exclusivamente en el servidor.

## Verificación

- `hub/tests/commercial-pages.test.mjs`: contrato estático y ausencia de secretos.
- `hub/tests/browser-smoke.mjs`: bienvenida, rutas de recomendación de los 3 productos, CTA correcto, reinicio, enlaces y responsive.
- No declarar integración real IA/compras por tener aprobado solo el flujo guiado.
