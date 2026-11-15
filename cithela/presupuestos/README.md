# CITHELA · Presupuestos v0.2 — rama de prueba

**Estado 15/11/2026: implementación de desarrollo, NO habilitada para clientes, SIN cambios persistentes en Supabase ni la agenda actual.**

PR de trabajo: https://github.com/SpukLab/spuklab-builds/pull/155

## Dos vistas separadas

- `index.html`: prototipo visual con pacientes **ficticios**, sin ninguna conexión a la base.
- `cloud.html`: interfaz profesional que reutiliza la sesión Supabase existente de CITHELA en **el mismo origen web**. Solo se podrá probar completamente cuando el backend de Presupuestos esté habilitado. No ofrece login independiente ni permite saltar el rol profesional.

La navegación principal `cithela/index.html` permanece **idéntica** a `main`: no se agregó una sexta pestaña ni una ruta pública prematura.

## Flujo desarrollado

1. Obtener establecimiento autorizado desde la membresía existente y cargar pacientes.
2. Crear/editar/archivar precios habituales por establecimiento (solo propietario/administrador).
3. Elegir paciente, agregar hasta 50 conceptos (incluido importe personalizado), cantidades y descuento.
4. Guardar **borrador** con totales validados en backend; volver al historial y reabrir borrador.
5. Copiar texto de WhatsApp y generar archivo PDF mediante diálogo nativo **solo a partir del presupuesto guardado**.
6. Registrar manualmente **enviado → aceptado/rechazado**, con versión de escritura y bloqueo de edición después de enviar.
7. Conservar snapshots de importes: cambiar el catálogo no modifica presupuestos anteriores.

Envío por WhatsApp: **supervisado**; no se envía mensaje ni se confirma el estado automáticamente. No contiene facturación fiscal ni cobros.

## Persistencia preparada, no aplicada

Archivo: `cithela/supabase/cithela_quotes_v1.sql`.

Tablas nuevas:
- `public.cithela_quote_catalog`: tarifas habituales ligadas al establecimiento; servicio de agenda opcional.
- `public.cithela_quotes`: ficha del paciente, snapshot de conceptos/precios, descuentos, referencia, validez, estado y auditoría.

`public.cithela_quote_command` delega en función privada con autenticación y roles. Ningún usuario `anon` ni `authenticated` tiene permisos directos sobre tablas de presupuestos; RLS activo y sin políticas de lectura pública. Todas las operaciones tienen comprobación de establecimiento, membresía y actividad. Lectura/escritura: owner, admin, operator; edición del catálogo: owner/admin. Viewer y pacientes quedan fuera.

Los conceptos no contienen datos clínicos estructurados, pero pueden describir tratamientos. Por eso **se consideran información sensible** para el diseño de privacidad y conservación.

## Validaciones ejecutadas

- Compilación SQL en la base CITHELA real usando `BEGIN...ROLLBACK`: tabla, funciones y grants comprobados.
- Sin permisos directos de lectura en tablas a `authenticated`, ni ejecución del RPC para `anon`.
- Sin acceso de un usuario autenticado sin membresía al establecimiento.
- Prueba transaccional con establecimiento/paciente **ficticios**: creación de tarifa, presupuesto de 2 × ARS 1.500 menos ARS 50 = ARS 2.950, cambio de estado, rechazo de edición después de envío y 3 eventos de auditoría: **PASS**.
- Verificación posterior de que las tablas y el RPC de Presupuestos **no existen** en producción: el rollback retiró todo.
- Node CI para `core.test.mjs`, `cloud.test.mjs`, comprobación de módulos, regresiones de CITHELA.

## Cómo ejecutar prototipo local

```bash
python3 -m http.server 8000
# http://localhost:8000/cithela/presupuestos/
node --test cithela/presupuestos/core.test.mjs cithela/presupuestos/cloud.test.mjs
```

`cloud.html` local no comparte la sesión de CITHELA publicada (origen distinto). Su QA real requiere la aplicación y el módulo en el mismo origen y la migración habilitada con controles.

## Bloqueos antes de ofrecer a profesionales

1. Revisar backup/restauración del proyecto Supabase y política de conservación para presupuestos.
2. Probar permisos con dos establecimientos, pacientes de prueba y cuentas owner/operator/viewer/patient (no solo una prueba simulada).
3. Aplicar la migración revisada y probar el RPC real con sesión JWT de usuario de prueba; no guardar datos reales hasta superar aislamiento.
4. Verificar visualmente Safari iPhone/iPad: editar catálogo, crear, recuperar, PDF, vista previa WhatsApp, datos largos, errores de red.
5. Activar acceso desde ficha del paciente (no una sexta pestaña fija) detrás de una opción por establecimiento.
6. Definir alcance comercial y precio de la opción con datos del piloto.

No activar autorespuesta, WhatsApp automático, historia clínica, odontograma, pagos ni facturación con este módulo.
