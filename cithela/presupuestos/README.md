# CITHELA · Presupuestos v0.2 — rama de prueba

**Estado 15/11/2026: implementación v0.4 de desarrollo, NO habilitada para clientes, SIN cambios persistentes en Supabase ni la agenda actual.**

PR de trabajo: https://github.com/SpukLab/spuklab-builds/pull/155

## Dos vistas separadas

- `index.html`: prototipo visual con pacientes **ficticios**, sin ninguna conexión a la base.
- `cloud.html`: interfaz profesional que reutiliza la sesión Supabase existente de CITHELA en **el mismo origen web**. Solo se podrá probar completamente cuando el backend de Presupuestos esté habilitado. No ofrece login independiente ni permite saltar el rol profesional.

La navegación principal conserva sus **cinco pestañas**. Solo en modo QA `?quotesPreview=1`, la ficha del paciente profesional cloud ofrece **Preparar presupuesto**. El enlace abre `presupuestos/cloud.html#tenant=<UUID>&person=<UUID>` y usa la membresía del establecimiento activo; el módulo comprueba que ese paciente pertenece al establecimiento autenticado. Esta opción no aparece a usuarios normales y no reemplaza el control de acceso del backend.

## Flujo desarrollado

1. Obtener establecimiento autorizado desde la membresía existente y cargar pacientes.
2. Crear/editar/archivar precios habituales por establecimiento (solo propietario/administrador).
3. Elegir paciente, agregar hasta 50 conceptos (incluido importe personalizado), cantidades y descuento.
4. Guardar **borrador** con totales validados en backend; volver al historial y reabrir borrador.
5. Copiar texto de WhatsApp y generar archivo PDF mediante diálogo nativo **solo a partir del presupuesto guardado**.
6. Registrar manualmente **enviado → aceptado/rechazado**, con versión de escritura y bloqueo de edición después de enviar.
7. **Duplicar como nuevo** a partir de un presupuesto guardado, preservando la versión enviada/aceptada y sus importes originales.
8. **Recuperación de fallas:** si el backend confirmó guardado o cambio de estado, una falla posterior al cargar el historial mantiene el comprobante disponible y evita duplicar la solicitud. Advertencia antes de descartar un borrador sin guardar.
9. Conservar snapshots de importes: cambiar el catálogo no modifica presupuestos anteriores.

Envío por WhatsApp: **supervisado**; no se envía mensaje ni se confirma el estado automáticamente. No contiene facturación fiscal ni cobros.

## Persistencia preparada, no aplicada

Archivo: `cithela/supabase/cithela_quotes_v1.sql`.

Tablas nuevas:
- `cithela_private.cithela_quote_enablements`: habilitación opcional **desactivada por defecto**; administrada fuera del navegador profesional y protegida mediante revocación de permisos y RLS.
- `public.cithela_quote_catalog`: tarifas habituales ligadas al establecimiento; servicio de agenda opcional.
- `public.cithela_quotes`: ficha del paciente, snapshot de conceptos/precios, descuentos, referencia, validez, estado y auditoría.

`public.cithela_quote_command` delega en función privada con autenticación y roles. Ningún usuario `anon` ni `authenticated` tiene permisos directos sobre tablas de presupuestos; RLS activo y sin políticas de lectura pública. Todas las operaciones tienen comprobación de establecimiento, membresía y actividad. Lectura/escritura: owner, admin, operator; edición del catálogo: owner/admin. Viewer y pacientes quedan fuera. **Sin habilitación de establecimiento, todos los comandos devuelven `feature_disabled`**, incluso aunque el esquema esté instalado.

Edición y archivo de tarifas usan `expected_updated_at`; dos operadores o dispositivos no pueden sobrescribir silenciosamente un precio actualizado. El cierre de sesión o cambio de cuenta en otra pestaña borra los presupuestos, datos del paciente, texto de WhatsApp y totales de impresión de la vista.

Los conceptos no contienen datos clínicos estructurados, pero pueden describir tratamientos. Por eso **se consideran información sensible** para el diseño de privacidad y conservación.

## Validaciones ejecutadas

- Compilación SQL en la base CITHELA real usando `BEGIN...ROLLBACK`: tabla, funciones y grants comprobados.
- Sin permisos directos de lectura en tablas a `authenticated`, ni ejecución del RPC para `anon`.
- Sin acceso de un usuario autenticado sin membresía al establecimiento.
- Prueba transaccional con establecimiento/paciente **ficticios**: creación de tarifa, presupuesto de 2 × ARS 1.500 menos ARS 50 = ARS 2.950, cambio de estado, rechazo de edición después de envío y 3 eventos de auditoría: **PASS**.
- Verificación posterior de que las tablas y el RPC de Presupuestos **no existen** en producción: el rollback retiró todo.
- Matriz transaccional (17 aserciones) de habilitación por establecimiento, roles owner/admin/operator/viewer, aislamiento cruzado, idempotencia, caducidad de versión, transición de estado e inmutabilidad post-envío.
- Node CI para `core.test.mjs`, `cloud.test.mjs`, `integration.test.mjs`, comprobación de módulos y regresiones de CITHELA.
- Navegación automatizada en Chromium y WebKit a 320/390/768/1280 px con datos 100 % simulados, capturas sin información real. Pruebas de fallo del historial tras guardado, descarte de borrador, duplicación sin modificar el original y limpieza al cambiar de cuenta. Esto **no sustituye** a Safari en iPhone/iPad.

## Cómo ejecutar prototipo local

```bash
python3 -m http.server 8000
# http://localhost:8000/cithela/presupuestos/
node --test cithela/presupuestos/core.test.mjs cithela/presupuestos/cloud.test.mjs
```

`cloud.html` local no comparte la sesión de CITHELA publicada (origen distinto). Su QA real requiere la aplicación y el módulo en el mismo origen y la migración habilitada con controles.

## Checklist de activación

Consultar [PILOTO.md](./PILOTO.md): verificación de respaldo, pruebas con JWT real, aislamiento por establecimiento, QA móvil y reversión rápida de la habilitación, sin tocar las reservas.

## Bloqueos antes de ofrecer a profesionales

1. Revisar backup/restauración del proyecto Supabase y política de conservación para presupuestos.
2. Probar permisos con dos establecimientos, pacientes de prueba y cuentas owner/operator/viewer/patient (no solo una prueba simulada).
3. Aplicar la migración revisada y probar el RPC con JWT real de cuentas de prueba (la matriz anterior simula auth.uid en transacciones). Habilitar exclusivamente un establecimiento piloto luego de validar aislamiento; todos los demás permanecen desactivados.
4. Verificar visualmente Safari iPhone/iPad: editar catálogo, crear, recuperar, PDF, vista previa WhatsApp, datos largos, errores de red.
5. Activar acceso desde ficha del paciente (no una sexta pestaña fija) detrás de una opción por establecimiento.
6. Definir alcance comercial, precio, privacidad y mecanismo administrativo de activación/desactivación por establecimiento con datos del piloto.

No activar autorespuesta, WhatsApp automático, historia clínica, odontograma, pagos ni facturación con este módulo.

## Observaciones UX de QA

- En móvil el editor administrativo del catálogo está plegado de manera predeterminada, evitando desplazar el resumen y la acción Guardar hasta el final de un formulario secundario.
- Los presupuestos enviados o resueltos muestran su estado como solo lectura, sin el texto ambiguo «Actualizar borrador».
- En el cambio de sesión, el módulo invalida respuestas de solicitudes pendientes para que una operación de la cuenta anterior no repueble la pantalla.

## Odontología — obra social/prepaga (prototipo del 17/11/2026)

- La demostración visual de `presupuestos/index.html` incorpora **Particular / Obra social / Prepaga**, entidad, plan opcional y estado de autorización manual.
- `odontologia.mjs` y sus pruebas diferencian el **importe del tratamiento** del **monto reconocido por cobertura** y de la **diferencia estimada a cargo del paciente**. Sin una autorización marcada manualmente no se infiere ni muestra copago: el importe queda indeterminado.
- No solicitar número de afiliación, historia clínica ni documentos. No consultar coberturas ni inventar porcentajes. El presupuesto no es factura, liquidación ni autorización de la entidad.
- **Alcance actual:** demo con datos ficticios, no guarda cobertura en el servidor. No incorporar el formulario directamente al `cloud.html` productivo sin snapshot persistido, controles por tenant/rol, auditoría, política de privacidad y pruebas.
- Siguiente cambio sobre esta misma PR: agregar metadatos de cobertura al esquema/RPC con validación de campos permitidos, histórico inmutable, pruebas de aislamiento con JWT y opción visible únicamente en el perfil odontológico cuando la empresa habilite Presupuestos.
- No modificar precios del catálogo por defecto al seleccionar una obra social. Los aranceles por convenio necesitan acuerdos, vigencia, autorización y verificación propios.
