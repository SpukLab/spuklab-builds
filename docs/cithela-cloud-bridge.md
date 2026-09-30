# CITHELA — Cloud bridge checkpoint

Estado: preparado el 2026-09-30.

## Objetivo

Conectar la preview web al backend Supabase sin cambiar todavía la fuente autoritativa de la UI. La agenda visible sigue en `localStorage` hasta superar pruebas reales de multi-dispositivo.

## Implementación

`turnos_v2.html` incorpora `window.CithelaCloud` con:

- carga asíncrona de `@supabase/supabase-js@2.117.2`;
- Project URL + publishable key únicamente;
- persistencia/refresh de sesión del SDK;
- login con email + password para cuentas existentes;
- lectura del primer membership, tenant, servicios, recursos y horarios;
- bootstrap remoto mediante `cithela_bootstrap_tenant`;
- disponibilidad remota mediante `cithela_availability_query`;
- `person.resolve` mediante `cithela_directory_command`;
- create/confirm/cancel/reschedule mediante `cithela_reservation_command`;
- diagnóstico y cierre de sesión cloud.

El SDK se carga después de que arranca la app. Un fallo de red/CDN no impide usar el modo local.

## UI

En Configuración aparece **Nube CITHELA** con estado de SDK/sesión/workspace y acciones de prueba.

La sección Infraestructura diferencia explícitamente:

- persistencia activa: LOCAL;
- backend Supabase: LISTO;
- bridge cloud: conectado/standby;
- multiusuario UI: NO hasta completar el gate.

## Seguridad

- No hay secret key ni service-role en el HTML.
- Sólo se usa la publishable key, protegida por Auth + RLS.
- La UI no obtiene permisos de escritura directa adicionales.
- Las mutaciones remotas siguen pasando por RPCs controladas.

## Decisión de onboarding

No se habilita todavía `signUp` desde esta preview. Primero debe existir una URL pública estable y quedar fijada en la configuración de redirects de Supabase Auth. Esto evita enlaces de confirmación que regresen a una URL temporal o inválida.

## Verificación

- JavaScript parse check: PASS.
- IDs HTML duplicados: 0.
- SDK pinned: PASS.
- Publishable-only credential check: PASS.
- runtime `persistence:'local'`: PASS.
- cloud init no bloqueante: PASS.

## Próximo gate

1. URL pública estable.
2. Configurar Auth redirect.
3. Crear/usar una cuenta real de operador.
4. Bootstrap del workspace y horarios.
5. Probar dos dispositivos contra el mismo tenant.
6. Sólo después activar remote-primary y comenzar el adaptador WhatsApp real.
