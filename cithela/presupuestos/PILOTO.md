# CITHELA · Presupuestos — activación controlada y salida a piloto

**Estado: pendiente de lanzamiento.** Documento operativo para el equipo técnico, no un procedimiento que deba ejecutar el profesional. No activar para clientes mientras falte un control. Actualización 24/11: el RPC requiere también catálogo de paquetes disponible, grant individual `pilot`/`active` vigente y acceso comercial efectivo `can_book`. La habilitación técnica sola ya no alcanza.

## 1. Preparación

- Trabajar sobre la PR #155 y la migración revisada `cithela/supabase/cithela_quotes_v1.sql`. Mantenerla en borrador hasta pasar pruebas de identidad, navegador y privacidad.
- Registrar y **verificar** un respaldo recuperable de CITHELA antes de cualquier cambio persistente; no asumir que el plan Supabase incluye backups automáticos.
- Usar un establecimiento de pruebas existente con cuentas de QA. **No crear otro proyecto Supabase ni alterar el piloto actual**.
- Definir texto de privacidad, destinatarios autorizados, plazo de conservación de presupuestos y procedimiento de corrección/eliminación. Los nombres de tratamientos pueden revelar información de salud.
- La configuración `cithela_private.cithela_retention_settings` ya existe para otros flujos de CITHELA. **No asumir que borra automáticamente `cithela_quotes`**; no hay purga de presupuestos implementada.

## 2. Verificaciones de base de datos

Tras aplicar una migración revisada en un entorno autorizado, comprobar **sin consultar datos personales**:

```sql
select
  to_regclass('public.cithela_quotes') as quotes_table,
  to_regclass('public.cithela_quote_catalog') as catalog_table,
  to_regclass('cithela_private.cithela_quote_enablements') as enablements,
  to_regprocedure('public.cithela_quote_command(uuid,text,text,jsonb)') as rpc,
  has_table_privilege('authenticated','public.cithela_quotes','SELECT') as auth_direct_read,
  has_function_privilege('anon','public.cithela_quote_command(uuid,text,text,jsonb)','EXECUTE') as anon_rpc;
```

Resultado esperado: objetos presentes; `auth_direct_read=false`; `anon_rpc=false`. Los datos se consultan por RPC con control de establecimiento y rol. RLS activo en las tres tablas nuevas.

**Sin habilitar** un establecimiento, el RPC debe devolver `feature_disabled` incluso para su propietario autenticado. Nunca insertar una habilitación automáticamente al migrar.

## 3. Prueba con sesiones reales

Usar dos establecimientos distintos y personas inventadas. Ejecutar con sesiones JWT de usuarios diferentes, no únicamente SQL con `request.jwt.claim.sub` simulado.

| Escenario | Resultado esperado |
|---|---|
| Propietario A crea precio y presupuesto para paciente A | Permitido |
| Operador A crea presupuesto para paciente A | Permitido |
| Operador A cambia precio del catálogo | Denegado |
| Visor o paciente A accede al módulo profesional | Denegado |
| Usuario A consulta, modifica o referencia persona de B | Denegado |
| Dos dispositivos editan misma tarifa | El segundo recibe `stale_write` |
| Enviar presupuesto y luego intentar editarlo | `quote_immutable` |
| El RPC confirma guardado pero falla consulta de historial | Se conserva presupuesto y referencia, sin duplicarlo |
| Cerrar sesión o cambiar de usuario en otra pestaña | Se oculta información previa |

El operador no debería poder abrir directamente los registros por la Data API. Usar IDs ficticios y eliminar sus datos al cerrar el piloto según la política aprobada.

## 4. Safari y UX

Validar en iPhone y iPad reales: acceso desde ficha del paciente, creación, guardado, recuperación, errores de conexión, cambio de cuenta, exportación a PDF, copiar mensaje WhatsApp y confirmar manualmente estado. Probar nombres extensos, montos con centavos y giros horizontal/vertical.

En GitHub Actions, `cithela/presupuestos/browser-smoke.cjs` ya automatiza Chromium a 320/390/768/1280 px con un backend simulado. **Chromium no reemplaza Safari ni autentica un usuario real.**

## 5. Activar exclusivamente el establecimiento piloto

Sólo después de aprobar los pasos anteriores, habilitar el catálogo y grant individual mediante el circuito administrativo existente (sin cobros), y ejecutar la activación como operación administrativa autorizada en Supabase. Identificar el **UUID exacto** del establecimiento que se validó; no usar nombre comercial como selector.

```sql
-- Ejemplo orientativo. NO ejecutar sin sustituir el UUID y validar todo el checklist.
begin;
insert into cithela_private.cithela_quote_enablements
  (tenant_id, enabled, enabled_at, updated_at)
values ('REEMPLAZAR_UUID_VALIDADO'::uuid,true,now(),now())
on conflict (tenant_id) do update
  set enabled=excluded.enabled,
      enabled_at=excluded.enabled_at,
      updated_at=now();
-- Verificar resultado/UUID antes del commit.
commit;
```

No habilitar a otros profesionales ni a pacientes hasta revisar resultados. El control de interfaz `?quotesPreview=1` es solo QA; **no sustituye la habilitación de backend**.

**Desactivar ante un problema:**

```sql
begin;
update cithela_private.cithela_quote_enablements
set enabled=false, updated_at=now()
where tenant_id='REEMPLAZAR_UUID_VALIDADO'::uuid;
commit;
```

Esto revoca el acceso por RPC al módulo para ese establecimiento. No elimina registros ni altera los turnos.

## 6. Aceptación para vender

Exigir: backup probado, prueba JWT multi-tenant, Safari real, privacidad/retención definidas, soporte y procedimiento de desactivación, revisión de costo y precio. Separar la tarifa del módulo de Presupuestos del servicio base; **todavía no hay un precio comercial aprobado**.

No automatizar envíos de WhatsApp, cobros, facturas ni acciones clínicas en este MVP.

## Revisión 24/11/2026
- Actualización sobre main preservando las mejoras de agenda, fichas, idioma y coberturas.
- Se elimina el fragmento SQL duplicado fuera de la función. Validación PostgreSQL real todavía pendiente para esta revisión.
- Pruebas adicionales: sin grant, grant vencido, cuenta vencida, catálogo indisponible y habilitación técnica apagada deben devolver `feature_disabled`; no se modifica el acceso comercial.
- Moneda ARS únicamente por ahora; USD y traducción completa quedan pendientes. No activar módulos ni aplicar migraciones desde esta PR.
