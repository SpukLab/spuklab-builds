# CITHELA · Administración, autoservicio y módulos por actividad
Fecha: 17/11/2026 · Contrato de implementación incremental

## Dos responsabilidades diferenciadas

### Administración comercial SpukLab (acceso restringido)
- **Clientes y establecimientos**: alta por invitación, estado de membresía, cuentas de prueba, cortesías y vencimientos
- **Autoservicio controlado**: estado cerrado/abierto, cupos, captcha, verificación y auditoría de altas
- **Suscripciones y pagos a SpukLab**: precios por país/moneda, Mercado Pago ARS, PayPal USD en sandbox hasta validación
- **Soporte y diagnósticos**: pruebas y herramientas técnicas aisladas, sin exposición a profesionales

No mezclar esta consola con el menú habitual del consultorio. No gestionar pagos entre pacientes y profesionales desde la suscripción comercial.

### Configuración del establecimiento (profesionales)
- **Mi establecimiento**: nombre visible, actividad, marca, idioma, zona horaria, contactos
- **Agenda y servicios**: horarios, duración, precios de referencia, recursos, señas manuales
- **Reservas online**: activar/desactivar, enlace amigable, copiar, compartir y QR; propietario/admin sin pedir al administrador comercial que habilite el enlace
- **Módulos**: Presupuestos (si habilitado para el tenant), ficha de cliente, funciones específicas del rubro
- **Personal y acceso**: miembros y roles, sujeto a controles del backend

El acceso rápido «Copiar enlace · Compartir · Ver QR» pertenece a la agenda; la gestión detallada queda en Ajustes/Mis reservas online. No mover el selector de idioma a una sección exclusivamente comercial.

## Matriz de perfiles (diseño; no activos por definición de texto)

| Actividad configurada por establecimiento | Herramientas visibles |
|---|---|
| Odontología | Agenda + servicios + Presupuestos + obra social/prepaga y estado de autorización (solo si módulos habilitados) |
| Peluquería/estética | Agenda + servicios + presupuestos/paquetes opcionales, sin mostrar automáticamente datos de cobertura odontológica |
| Seguros y gestión fiscal (Utah) | Agenda EN/ES, servicios y estados administrativos, enlace y SMS manual; presupuestos USD solo tras adaptación y seguridad |
| General | Agenda + reservas online, módulos elegidos por establecimiento |

**Regla:** la selección de rubro personaliza formularios y etiquetas; la seguridad se determina por tenant, membresía y permisos de servidor. No confiar en querystrings ni atributos del navegador como autorización.

## Presupuestos (PR #155)
- Catálogo por establecimiento; edición owner/admin; presupuestos por ficha de persona para roles autorizados
- Borrador → enviado → aceptado/rechazado, exportación y mensaje supervisado
- Odontología (demo): particular/obra social/prepaga, nombre/plan, autorización manual. El importe a cargo del paciente permanece **indeterminado** sin reconocimiento verificado por el profesional
- No modificar tarifas históricas ni deducir porcentajes de cobertura del nombre de un plan. Considerar convenios y planes específicos en una fase posterior

## Utah (PR #157)
- Fase inicial: citas para seguros auto/casa y asistencia administrativa en temporada fiscal, zona America/Denver, interfaz EN/ES, SMS manual con consentimiento
- `W-2`, `1099`, `1040`, `TC-40` y créditos fiscales se presentan solo como nombres de **servicios o documentos que debe traer la persona**; no subirlos a CITHELA ni calcular reintegros/créditos
- Diferenciar presupuesto **por honorarios del servicio** de una **declaración fiscal**, del cálculo de impuestos o de una cotización de prima de seguro
- No prometer presentación fiscal, asesoría ni venta de pólizas hasta verificar la actividad y habilitación profesional. Para preparación remunerada de declaraciones puede exigirse PTIN (https://www.irs.gov/tax-professionals/frequently-asked-questions-do-i-need-a-ptin); medidas de protección de datos: https://www.irs.gov/identity-theft-central/identity-theft-information-for-tax-professionals
- En esta fase no hay SMS automático ni autenticación por SMS, no hay acceso a números fiscales o historiales privados

## Etapas de publicación

1. Unificar navegación de la **administración comercial**, dejando paneles técnicos en «Diagnóstico», sin cambios de planes, pagos ni cuentas; conservar controles previos
2. Revisar y probar autoservicio restringido (CAPTCHA/email/OTP, retorno a profesional en iPhone y roles), después considerar apertura gradual con cupos
3. Completar Presupuestos para un tenant argentino de prueba con JWT real, RLS, Safari y backups; recién entonces activar y recoger feedback
4. Odontología: persistir el estado de cobertura como snapshot vinculado al presupuesto y ensayar sin datos de salud reales
5. Utah: agenda y SMS manual primero; moneda USD, privacidad, permisos y proveedor SMS después; nunca mezclar este piloto con el circuito de tratamientos

**Control de cambios:** ninguna fase habilita automáticamente nuevas altas, cobros, envío automático de WhatsApp/SMS, cálculo tributario, ni exposición de datos clínicos. Las PR #123, #155, #157, #168 son borradores y deben verificarse contra main antes de fusionar.
