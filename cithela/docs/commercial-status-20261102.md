# CITHELA — Estado comercial visible para profesionales

Fecha: 2026-11-02. Estado: **RPC ya desplegado y verificado en Supabase**; interfaz en PR #111. Alcance: consulta de estado; no se activan cobros, alta pública, checkout ni nuevas pruebas.

## Función y permisos
Se agregó `public.cithela_commercial_status(p_tenant_id uuid)`. Es el único punto de lectura de los datos comerciales para el navegador:

- El estado real proviene de `cithela_private.commercial_entitlement_snapshot`, el mismo evaluador empleado para bloquear reservas.
- La función solo acepta `auth.uid()` con membresía `owner` o `admin` del tenant solicitado; `anon` y `PUBLIC` no tienen permiso `EXECUTE`. El acceso cruzado retorna `forbidden`, sin confirmar existencia.
- `SECURITY DEFINER` justificado únicamente porque el ledger privado está bloqueado a roles del navegador. `search_path` vacío; verificación de pertenencia previa a consultar. Se debe monitorear que una actualización no amplíe esta superficie.
- Solo devuelve: `ok`, estado, `can_book`, fecha final de trial, fin del período, días restantes calculados en Postgres y fecha de verificación; **no** devuelve identificadores de pago, nombres de pacientes, notas ni tokens.
- Es lectura. La interfaz nunca otorga permisos por el resultado: las reservas siguen protegidas por RPC y trigger en Supabase.

## Ensayo de servidor (reversible)
Se cargó la nueva función en `BEGIN`, con `SET LOCAL ROLE authenticated` y las identidades de los 2 profesionales existentes:

1. `anon` no puede ejecutar la función.
2. El profesional A consulta su tenant: `legacy`, `can_book=true`.
3. El mismo usuario consulta B: `forbidden`.
4. Bajo una modificación **transaccional y revertida** del entitlement A, se comprobó `trialing`, recuento de días del servidor y `trial_expired` con `can_book=false`.
5. `ROLLBACK` dejó 2 cuentas `legacy`, 15 turnos y la función sin desplegar antes de la activación.

**Despliegue posterior:** migración `cithela_commercial_status_owner_rpc_20261102` aplicada con `success=true`. Nueva prueba contra el RPC real: titular puede leer `legacy`, intento de tenant ajeno devuelve `forbidden`, operador no puede consultar estado comercial y `anon` no tiene permiso de ejecución. Todos los escenarios de sesión/rol se probaron con `BEGIN/ROLLBACK`. Resultado final: 2 tenants, 15 turnos, 2 entitlements `legacy`, sin modificaciones de reservas.

## Experiencia profesional
El nuevo apartado *Estado del servicio* aparece en **Configuración** únicamente para el titular/administrador cloud del establecimiento. Los demás perfiles y el modo local no lo ven.

- `legacy`: «Servicio habilitado», sin invitar a pagar.
- `trialing`: «Prueba gratuita en curso» con días restantes devueltos por el servidor.
- `trial_expired`, `past_due`, `canceled`, `suspended`: informa la pausa de nuevas reservas, conservando consulta/cancelaciones.
- `active`: confirma suscripción activa sin publicar mecanismos de cobro inexistentes.
- Error de conectividad o RPC: «Estado no disponible», sin asumir activo ni impedir reservas.

La consulta se añade al `CithelaCloud.refresh()` existente y no es bloqueante; se limpia al cerrar sesión o cambiar de espacio. No se duplica un wizard ni se incorpora backend adicional.

## Pendientes de comercialización
1. Flujo real de dos sesiones y prueba visual en iPhone/iPad/PC.
2. Correo transaccional estable y aceptación de términos, privacidad, soporte y datos del prestador.
3. Mercado Pago: credenciales exclusivamente servidor, token/secret del webhook, idempotencia, validación de precio/currency, reconciliación y baja; no activar por retorno del navegador.
4. Definir precio y facturación antes de publicar el CTA de 7 días gratis.
5. Confirmar respaldo/restauración y proceso de exportación/cancelación.

**No se debe activar un botón «Pagar ahora» antes de tener checkout real y webhook verificado.**

**No verificado aún:** interfaz visual completa desde Safari iPhone/iPad con sesión real. Los tests de interfaz y smoke GitHub verifican el comportamiento automatizado, no sustituyen esa prueba.
