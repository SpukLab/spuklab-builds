# CITHELA · Presupuestos (rama de trabajo)

**Estado:** prototipo aislado, no publicado, sin acceso a datos reales (15/11/2026).

## Alcance construido
- Interfaz adaptable a móviles, con diseño CITHELA, datos ficticios y precios editables.
- Varios servicios por presupuesto, cantidades, descuentos, cálculos de pesos argentinos con centavos enteros y límites.
- Snapshot de precio por línea: cambiar el catálogo futuro no alterará presupuestos históricos.
- Simulación de estados: borrador → enviado → aceptado/rechazado (solo manual).
- Impresión/PDF desde el diálogo nativo del navegador.
- Mensaje para WhatsApp preparado para revisión/copiar; **no se envía**.
- Tests puros en `core.test.mjs`. No hay dependencias npm.

## Ejecutar prototipo
Desde la raíz del repositorio:
```sh
python3 -m http.server 8000
```
Abrir `http://localhost:8000/cithela/presupuestos/`. Se usa servidor porque `index.html` importa `core.mjs` como módulo.
`node --test cithela/presupuestos/core.test.mjs` comprueba operaciones y reglas.

## Arquitectura prevista (pendiente de implementación)
La base productiva existente ya usa `cithela_tenants`, `cithela_tenant_memberships`,
`cithela_people` y `cithela_services`; `cithela_services` tiene duración y seña, pero no precio general.

1. **Catálogo valorizado:** opciones por establecimiento, precios vigentes en unidades menores (centavos), servicio opcional; sin forzar los precios sobre las señas.
2. **Encabezado:** `tenant_id`, `person_id`, identificador/número por establecimiento, creador, fecha, vigencia, estado y totales; FK compuesta al paciente del mismo establecimiento.
3. **Líneas snapshot:** nombre de servicio, cantidad, precio unitario, descuento y total calculado en backend; preservar precio original.
4. **Auditoría y revisiones:** estado/enviado/aceptación registrados, versión de presupuesto; una edición posterior a envío debe crear nueva revisión, no sobrescribir la enviada.
5. **Seguridad:** RLS por establecimiento en todas las tablas públicas; owner/admin/operator autorizados según operación; paciente y viewer sin acceso por defecto hasta diseñar permisos; nada de `service_role` en el navegador; verificaciones de escritura/aislamiento y copias de seguridad antes de migrar.
6. **Canales:** PDF seguro con branding del establecimiento; WhatsApp iniciado por profesional con vista previa y consentimiento; no generar envíos automáticos ni marcar «enviado» antes de confirmación.
7. **Agenda/historial:** acceso desde ficha del paciente, opcionalmente desde turno; registrar solo información comercial, sin introducir diagnóstico, odontograma ni historia clínica en esta fase.

**Fases de integración:** (1) validación visual con datos ficticios; (2) diseño y tests SQL/RLS en entorno separado; (3) persistencia y vinculación a personas; (4) PDF + envío supervisado; (5) despliegue gradual por establecimiento. Mantener el piloto actual y sus reservas intactos.

## No incluido (deliberadamente)
- Datos reales, acceso Auth/Supabase, tablas, migraciones, actualización de `cithela/index.html`, rutas de navegación productivas.
- Generación automática de archivo PDF en servidor (el navegador ofrece «Guardar como PDF» al imprimir).
- Envíos WhatsApp reales, pagos, aceptación electrónica, odontograma o datos clínicos.
- Contabilidad, facturación fiscal, consentimiento legal y gestión de cuotas.
