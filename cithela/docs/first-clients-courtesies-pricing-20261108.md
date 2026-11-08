# CITHELA — Cortesías y acuerdos individuales para primeros clientes
**Fecha:** 2026-11-08 · **Estado:** proceso piloto supervisado, sin cobros ni precios individuales aplicados.

## Flujo confirmado para dos profesionales reales

1. Administrador SpukLab: `invitar-profesionales.html` → autorizar cada correo → compartir el enlace por WhatsApp.
2. Profesional: crear/verificar cuenta con ese correo → crear establecimiento independiente → configurar horarios/servicios. El alta genera un trial **de 7 días**.
3. Administrador: `comercial-admin.html` → **02 / Clientes sin cargo** → seleccionar nuevo establecimiento → **30 días** → escribir motivo explícito → **Otorgar cortesía**, confirmar.
4. El servidor escribe `cithela_complimentary_grants` auditada; el evaluador `commercial_entitlement_snapshot` concede acceso a reservas solo durante la cortesía. El estado se ve en **Ajustes → Estado del servicio** del profesional.
5. Al vencer la cortesía, no borrar datos ni reservas existentes. No crear cobros ni suscripciones por esta operación. Si el cliente decide contratar, usar un procedimiento de cobro verificado distinto; el sistema actual no lo automatiza.

**Aclaración temporal:** los 30 días se cuentan desde la **fecha efectiva de otorgamiento**, por lo que pueden superponerse al trial si se otorgan al comienzo. Si se promete un mes **después** de los siete días iniciales, el administrador debe otorgarlo cuando termine el trial (o implementar programación server-side de `starts_at` previa revisión de seguridad). No asegurar 37 días a alguien si hoy la operación solo habilita 30 días desde ahora.

**Pilotos `legacy`** (ODonto D y Defro tattoo): ya tienen acceso protegido y la UI bloquea otorgar/revocar cortesía. No usar estas cuentas como casos de prueba. Las invitaciones se emiten para correos nuevos; no son sinónimo de cortesías.

## Tarifa estándar frente a una condición especial

- `cithela_price_options` contiene borradores **globales** de precio; elegir uno no modifica contratos ni pagos. No usar el selector como descuento especial por cliente.
- No existe aún un registro operativo de tarifa individual vinculada a un `tenant_id` ni integración verificada de Mercado Pago recurrente.
- Antes de habilitar precios especiales, definir un **acuerdo individual de solo escritura administrativa** con: tenant, importe ARS/mes, vigencia desde/hasta, motivo, versión de términos, aceptación del cliente, precio anterior y administrador. Registrar cada cambio en auditoría; nunca cambiar automáticamente contratos de MP existentes.
- Al crear una suscripción, la API debe recibir un precio cerrado e inmutable a partir de un acuerdo aceptado (no del selector global sin fijar). Conciliar el `provider_subscription_id` y las fechas de períodos pagados antes de activar servicio; renovación y baja tienen que estar contempladas.
- Un descuento manual/cortesía no debe generar un pago ficticio ni alterar el ciclo de facturación de Mercado Pago.

## Criterio de no regresión

- No habilitar el registro público, cobranzas, cambios de términos, eliminación de agendas, ni aplicar precio individual mientras ese módulo sea borrador.
- Proteger todas las operaciones en Edge (JWT confirmado y UUID de administrador global) y en SQL (solo `service_role` para RPC privilegiada), no confiar en ocultar botones.
- Mantener estado legible en iPhone, iPad y PC; no presentar controles técnicos de Mercado Pago a profesionales.
- Pruebas actuales: `cithela/commercial-admin.test.mjs` y `cithela/pilot-invitations.test.mjs`.
