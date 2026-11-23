# CITHELA — USA Taxes · fase administrativa v0.1 (2026-11-23)

**Estado:** pantalla de demostración bilingüe EN/ES con datos exclusivamente ficticios. Sin conexión al backend, sin base de datos, sin datos reales, sin proveedor SMS, sin cálculos fiscales y sin modificación de Mercado Pago. Esta rama **depende de PR #157**, no está integrada en `main`.

## Recorrido disponible

Abrir `cithela/international/taxes-preview.html` con servidor HTTP estático (carga módulos ES). No se habilita automáticamente en CITHELA.

- Tres citas ficticias de **temporada fiscal 2027 (año impositivo 2026)**, vinculadas a los servicios ya descritos en `utah-services.mjs`.
- Resumen de casos activos, listos para la cita y finalizados. No aparecen nombres ni teléfonos.
- Etapas administrativas (solo simulación): `contacted → scheduled → documents_pending → ready_for_preparer → completed`.
- Avanzar a la próxima etapa y marcar **una sola bandera genérica** «guía de preparación compartida». No almacenar qué documentos tiene o no tiene la persona.
- Guía informativa en español o inglés con referencias generales a W-2, 1099, 1095-A, 1098 y documentación del año previo **solo para llevar a la cita**.
- Texto neutral para copiar manualmente; **no se envía SMS**. Se evita mencionar en el mensaje la naturaleza tributaria de la cita, declaraciones o créditos.
- Horarios presentados en `America/Denver` (con cambios estacionales), no GMT fijo.
- Todo se conserva solamente en memoria de la pestaña; al recargar desaparecen los cambios.

## Datos aceptados en el modelo de demostración

`caseId` anónimo sintético, `serviceId`, fecha de la cita, etapa administrativa, indicador `guideShared` y versión. La entrada del modelo **rechaza campos no autorizados** (nombre, SSN, ITIN, bancos, ingresos, W-2, archivos, notas libres). Ni siquiera se registra presencia/ausencia de tipos específicos de documentos por individuo.

El estado «documents_pending» en el catálogo previo equivale a **preparación administrativa pendiente**. No certifica que la persona tenga o no un documento fiscal.

## Fuera del alcance

- Sin archivos, fotos, formularios tributarios completos, datos bancarios, de salud, pólizas, SSN/ITIN ni tax returns.
- Sin estimación de impuestos, EITC, CTC, PTC, deducciones, reintegros, cotizaciones o presentación ante IRS/Utah.
- Sin consentimiento SMS real, notificaciones automáticas ni enlaces de acceso.
- Sin pretender que la profesional sea preparadora fiscal registrada o productora de seguros habilitada: verificar su rol real antes del piloto.
- **No** sustituye software fiscal especializado ni resuelve requisitos de seguridad para un preparador de impuestos.

## Integración futura con CITHELA

1. Fusionar primero o integrar cuidadosamente las dependencias de PR #157 (EN/ES y SMS manual); mantener taxes desactivado hasta validar la experiencia internacional.
2. Reutilizar `cithela_services` y `cithela_appointments`; no crear otra agenda, directorio ni ficha. PR #202 ya prepara la ficha profesional agrupada pero **sigue sin fusionar**.
3. Colocar `USA Taxes` como **sección opcional por establecimiento**. No mostrarla a peluquerías, tatuadores ni otros rubros por defecto.
4. Guardar solo metadatos estrictamente necesarios para seguimiento, con permisos por establecimiento, rol y persona, control de versión y política de retención; evaluar si incluso el estado fiscal asociado a una persona amerita controles reforzados.
5. Si se requiere manipular documentación fiscal real, detener esta vía y realizar diseño y revisión regulatoria/seguridad aparte. No poner documentos en `cithela_people.notes`, en una respuesta de formulario común, en URLs ni en SMS.

## Verificación

```bash
node --test cithela/international/utah-services.test.mjs cithela/international/taxes-workflow.test.mjs
node --check cithela/international/taxes-workflow.mjs
node --check cithela/international/taxes-preview.mjs
node cithela/international/taxes-browser-smoke.cjs
```

El último comando requiere Playwright + Chromium y levanta un servidor **local** de pruebas. Verifica 320, 390 y 1280 px; genera capturas `cithela-taxes-320.png`, `cithela-taxes-390.png`, `cithela-taxes-1280.png`. La CI del PR adjunta esas capturas como artefactos si se ejecuta correctamente. **Emulación Chromium no equivale a una prueba física de Safari en iPhone.**

## Fuentes oficiales de referencia

- IRS — preparación de declaración y documentación: https://www.irs.gov/filing/gather-your-documents
- IRS — recordatorio de preparación para 2027: https://www.irs.gov/newsroom/irs-reminder-take-steps-now-to-make-tax-filing-in-2027-easier
- FTC — Safeguards Rule y programas de protección de información: https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know

Los documentos citados son ejemplos generales, **no una lista exigida para todos los contribuyentes**. Esta fase no aconseja ni determina elegibilidad tributaria, fechas de reintegro o consecuencias de una declaración.
