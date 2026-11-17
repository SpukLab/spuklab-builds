# CITHELA · Paquetes por cuenta y caducidad · 17/11/2026

## Estado
Módulo independiente del precio de consulta y de las suscripciones de Mercado Pago. **Preparado para piloto de administración, no representa cobros ejecutados.** La app existente no se deshabilita; los módulos no probados quedan indisponibles.

## Cuenta profesional
Cada tenant conserva:
- Agenda base y datos: no se borran por vencimiento ni por activar/desactivar complementos.
- Estado comercial existente (piloto protegido / prueba / cortesía / activo / vencido).
- Módulos potenciales: Presupuestos, Coberturas de salud, Taxes Utah, SMS.
- Autorización individual (solicitado, piloto, habilitado, deshabilitado), fecha de fin, revisión, moneda ARS/USD e importe mensual acordado **solo informativo**.
- Los paquetes se habilitan en servidor por tenant y únicamente si `package_catalog.available=true`. Todos empiezan **false**. No inferir de texto libre ni de menús.
- `cithela_professional_packages`: acceso de solo lectura al estado de módulos para miembros del establecimiento. La escritura sigue bloqueada al Edge admin con JWT confirmado y UID en secret.

## Administración SpukLab
`comercial-admin.html` incluye pestañas por establecimiento, paquete, vigencia e importe contractual y vista de cuentas con 14 días o menos hasta vencimiento. Permite copiar un mensaje de WhatsApp para enviarlo manualmente, con el contacto validado por el administrador. No hay envío automático y no contiene teléfono o información de pacientes.

## Principio de conservación
El estado vencido limita nuevas operaciones según la política comercial, pero la cuenta sigue existiendo. En producción `cithela_retention_settings.automatic_purge` es `false` y la columna exige por SQL que permanezca `false`; no se ha creado tarea de eliminación automática. El borrado definitivo será un procedimiento excepcional con aviso, exportación, consentimiento/obligaciones legales y registro, nunca un efecto colateral del vencimiento.

## Requisitos antes de habilitar nuevos módulos a personas reales
1. Comprobar las funciones del módulo y permisos del backend (RPC, RLS, multi-tenant).
2. Confirmar el profesional, el tenant, la vigencia de prueba y el tipo de datos.
3. Aprobar documentación de privacidad y conservación de datos sanitarios. Para impuestos en Utah, no almacenar datos de contribuyentes o W-2 sin revisión legal/seguridad.
4. Configurar SMTP propio para autenticaciones de correo, SPF/DKIM/DMARC y probar entrega. Supabase no garantiza ubicación de mensajes en bandeja principal.
5. Para WhatsApp automático: consentimiento, cuenta Business habilitada, plantilla aprobada y registro de entrega; mientras tanto solo mensaje manual.

## Despliegue/rollback
- SQL: `supabase/cithela_account_packages_20261117.sql`; aditivo, sin modificación de filas históricas.
- Edge: `cithela-commercial-admin`; acciones nuevas `modules_read`, `modules_set`, detrás del mismo guard de administrador.
- UI: `comercial-admin.html`. Si SQL o Edge no está disponible, muestra aviso y deja la consola comercial previa funcionando.
- Rollback funcional: marcar todos los módulos indisponibles en el catálogo, conservando los grants, o volver a versión anterior del Edge/UI. No borrar las tablas de auditoría.
