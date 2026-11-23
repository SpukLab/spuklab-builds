# CITHELA · USA Taxes & Insurance — presentación del piloto / pilot briefing

**Demo pública de datos ficticios:** https://cithela-usa-taxes-demo.vercel.app/  
**Verificación HTTP independiente:** [GitHub Actions — HTML y 3 módulos sin autenticación](https://github.com/SpukLab/spuklab-builds/actions/runs/45238767233)  

**Versión:** 23 de noviembre de 2026  
**Condición:** demostración con datos ficticios, no habilitada todavía para casos reales. Se requiere revisión y publicación controlada antes de compartir un enlace público.

## EN — What the professional can evaluate

**CITHELA is an appointment and follow-up assistant for independent professionals**, not a tax filing system.

The Utah pilot is designed to help with seasonal tax appointments and year-round insurance consultations, using a single appointment workspace.

- **Schedule services:** proposed options include individual tax intake, document review, tax-credit consultation, plus auto/home insurance appointments.
- **Track appointment progress:** Contacted → Scheduled → Preparation pending → Ready for appointment → Completed.
- **Prepare visitors:** share a general bilingual list of documents that *may* be useful for an appointment.
- **Keep reminders neutral:** prepare text that can be copied for manual sending, without tax details or personal identifiers.
- **Work in English or Spanish** and present appointment times in Utah local time (`America/Denver`, including daylight-saving changes).

**The current preview runs entirely with sample appointments**. It does not collect client details, taxpayer IDs (SSN/ITIN), W-2s, 1099s, policy files, bank data, refund amounts, or tax documents. It does not submit returns, estimate tax credits, send SMS automatically, or modify an existing CITHELA schedule.

### Three things to confirm before tailoring the pilot

1. Does your office **prepare tax returns**, or primarily arrange appointments and refer clients to a preparer?
2. Which appointment types are most common (tax intake, documentation review, auto/home insurance, other)?
3. What is your existing system for managing and securely storing tax documents? **No integration is requested at this stage.**

### Pilot acceptance checklist

- Review the demo on your own phone and laptop.
- Confirm service names and approximate appointment durations.
- Confirm that the five administrative stages match your workflow.
- Choose which client reminder wording is useful in English and Spanish.
- Do not enter real taxpayer information in the demo.
- Only after those checks: decide whether to create an isolated establishment for a controlled pilot, with separate security/retention review.

## ES — Qué puede evaluar el profesional

**CITHELA organiza citas y seguimiento**, no prepara declaraciones de impuestos.

El piloto de Utah propone una agenda única para la temporada fiscal y las consultas de seguros durante el resto del año.

- Servicios configurables: entrevista de impuestos, revisión general de documentación, consulta sobre créditos, seguros de auto o vivienda.
- Seguimiento del proceso: Contactado → Agendado → Preparación pendiente → Listo para la cita → Finalizado.
- Guía general de documentos para llevar a la consulta, disponible en español e inglés.
- Texto de recordatorio neutro y copiable, **sin envío automático**.
- Horarios de Utah con zona horaria `America/Denver`.

**La vista actual es una simulación**. No recibe SSN, ITIN, W-2, 1099, importes, datos bancarios, archivos o información real de contribuyentes. Tampoco calcula reintegros o créditos ni presenta declaraciones.

Antes de personalizar la versión real hay que confirmar si el profesional prepara declaraciones o solamente coordina citas, cuáles son sus servicios frecuentes y qué sistema usa para los documentos. No necesitamos acceso a ese sistema todavía.

## Estado técnico y condiciones para compartir

- **PR #157:** capa inicial de inglés/español, SMS manual y catálogo Utah. Sigue como borrador.
- **PR #211:** prototipo del recorrido USA Taxes, pruebas Node + navegador y capturas. Sigue como borrador, apilado sobre #157.
- **Acceso optativo en Ajustes:** en la rama del piloto, agregar `?taxesPreview=1` a la URL de CITHELA y entrar como profesional cloud verificado. Allí se ofrece «Abrir demostración de Taxes». El botón únicamente abre `./international/taxes-preview.html`, que usa datos sintéticos.
- **La demo standalone** se encuentra publicada en el proyecto Vercel independiente `cithela-usa-taxes-demo`, sin login y con datos ficticios. Es una **instantánea manual** de los archivos del PR #211, no una sincronización automática de despliegues futuros. No incluye acceso a CITHELA ni datos de personas.
- Sin cambios en Supabase, sin configuración SMS adicional, sin pagos, sin migraciones y sin activación por establecimiento.
- Falta prueba Safari en iPhone físico, evaluación de acceso/permisos y decidir cómo enlazar turnos reales con metadatos mínimos, sin fichas fiscales.

### Propuesta de lanzamiento gradual

**Etapa A — Mostrar:** publicar únicamente la demo con tres turnos ficticios; enviar al profesional la ficha bilingüe de arriba y solicitar comentarios sobre servicios/etapas.

**Etapa B — Agenda piloto:** configurar un establecimiento independiente con los servicios que el profesional confirme; utilizar la agenda CITHELA existente, no una agenda duplicada. Conservar el módulo de seguimiento fiscal en modo prueba hasta tener autorización y almacenamiento de metadatos mínimos.

**Etapa C — Operar:** habilitar el seguimiento administrativo con permisos, privacidad y retención verificados; SMS inicialmente manual y neutral. Los documentos fiscales seguirán en el sistema especializado del profesional.

**No realizar Etapa C antes de validar los requisitos de seguridad aplicables a su actividad.**
