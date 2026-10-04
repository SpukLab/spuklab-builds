# CITHELA — Comprobantes de seña (propuesta, sin implementación)

**Origen:** sugerencia surgida durante las pruebas de la agenda en iPhone/iPad del 4 de octubre de 2026.

## Objetivo y límite

Permitir que el paciente adjunte **hasta dos fotografías del comprobante de una transferencia** asociadas a un turno que tiene una seña pendiente. Facilitar al profesional la conciliación manual sin procesar pagos dentro de CITHELA.

**Una fotografía no acredita el cobro.** El estado económico del turno continúa como `requested` (seña pendiente) después de la carga. Solo un operador autorizado puede registrar `verified` tras revisar efectivamente la acreditación en la cuenta bancaria o medio de cobro del establecimiento. No usar OCR, IA, extracción de datos bancarios ni verificación automática en el MVP.

## Experiencia del paciente

- Mostrar «Adjuntar comprobante (opcional)» únicamente cuando el turno sea propio, esté vigente y tenga una seña pendiente; máximo **2 imágenes**.
- Admitir imágenes JPEG/PNG/WebP. Redimensionar/comprimir en el dispositivo cuando sea necesario y eliminar metadatos EXIF antes de subir. Límite objetivo: **2 MB por imagen** después de la compresión.
- Permitir previsualizar, quitar y reemplazar las imágenes antes de enviar.
- Tras la carga, mostrar «Comprobante recibido, pendiente de revisión del establecimiento», distinto de «Seña acreditada».
- Avisar que solo debe subirse la parte necesaria del comprobante, evitando capturar saldo, movimientos o datos financieros ajenos. No incorporar las imágenes a borradores de WhatsApp.

## Experiencia profesional

- Indicar «Comprobante por revisar» junto a la seña del turno, con acceso a las dos imágenes.
- El botón «Registrar cobro verificado» sigue exigiendo selección del medio comprobado y confirmación humana. La imagen nunca lo habilita ni lo ejecuta por sí sola.
- Mantener el historial de recepción/revisión, actor, hora y cambios, sin guardar datos bancarios adicionales extraídos de la imagen.
- Cuando se cancele el turno o se exima la seña, impedir nuevas cargas; conservar o eliminar los archivos conforme a una política explícita de retención.

## Aislamiento, almacenamiento y privacidad

- **Bucket privado** en Supabase Storage, separado del bucket público `cithela-branding`. Nunca usar URL pública y no almacenar imágenes en `localStorage`.
- Asociar cada objeto a `tenant_id`, `appointment_id` y el usuario vinculado a la persona; validar que el turno, la seña y el tenant correspondan al solicitante en el servidor mediante una RPC autorizada. No confiar en identificadores o estados enviados por el navegador.
- Lectura de los comprobantes: exclusivamente la persona vinculada al turno y el personal operativo expresamente autorizado del mismo tenant. Considerar que el rol `viewer` no tenga acceso por defecto.
- Visualización profesional mediante enlaces firmados de corta duración. Evitar registrar las URLs o bytes en eventos operativos, analíticas, errores y mensajes.
- Validar tamaño, tipo MIME y firma real de archivo; denegar SVG, HTML, ejecutables y rutas arbitrarias. Limitar cantidad y frecuencia por usuario/turno, comprobar concurrencia y limpiar archivos huérfanos.
- Definir base legal, aviso de privacidad y **plazo de retención limitado** antes de recibir comprobantes de usuarios reales, con opción de eliminación según las obligaciones aplicables.
- Ensayar acceso denegado entre dos tenants y entre pacientes distintos. Una foto no debe ser legible por usuarios con solo la ruta del objeto.

## Dependencias para aprobar la implementación

1. Resolver los bloqueantes P0 documentados en `cithela/docs/pilot-readiness-audit-20261004.md`, especialmente modo local de demostración, permisos de fichas y aviso de privacidad.
2. Probar un segundo tenant y dos pacientes con identidades diferentes; demostrar aislamiento real de los archivos.
3. Diseñar y probar el ciclo de vida del archivo: selección, compresión, carga, renovación de sesión, reemplazo, borrado y limpieza ante cancelación y fallo de red.
4. Mantener la carga opcional. No condicionar la reserva ni la acreditación al envío del comprobante: el establecimiento puede verificar directamente el banco.

**Estado:** diseño aprobado para evaluación de alcance; no está implementado ni disponible para pacientes.
