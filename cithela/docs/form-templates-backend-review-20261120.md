# CITHELA · Persistencia de plantillas de formularios (borrador de revisión)

**Estado:** PR técnico independiente, **sin aplicar SQL** a Supabase y **sin modificar la interfaz**.
Objetivo: guardar únicamente *definiciones* de formularios por establecimiento y servicio; todavía NO guardar ni enviar respuestas de personas.

## Base verificada (2026-11-20)

- El Supabase CITHELA actual tiene `public.cithela_tenants`, `cithela_tenant_memberships`, `cithela_services`, `cithela_people` y `cithela_operational_events`.
- `cithela_services` tiene una clave única por `(tenant_id,id)`; sus servicios pueden estar activos o inactivos.
- Roles existentes: `owner`, `admin`, `operator`, `viewer`.
- `cithela_people` ya tiene contacto y notas. **No crear otra tabla de pacientes**.
- Todavía no existía una tabla para plantillas de formularios.

La consulta fue **solo de metadatos**; no se leyó ningún contacto ni dato de pacientes.

## SQL propuesto (NO EJECUTAR en producción)

`cithela/sql-review/form-templates-rpc-20261120.sql`

Define:
- Tabla `cithela_private.cithela_form_templates` protegida por RLS y sin permisos directos para `anon` o `authenticated`.
- FK compuesta `(tenant_id,service_id)` a los servicios existentes; no puede apuntar a otro establecimiento.
- Un formulario publicado por servicio, con borradores adicionales y archivo de versiones.
- Solo tipos de campo `text`, `textarea`, `select`, `checkbox` y hasta 15 campos; no archivos adjuntos.
- Funciones autenticadas con roles efectivos `owner/admin`, validación de tenant activo, versión esperada y estado.
- Listado acotado, acciones de guardar borrador, publicar o archivar.
- Eventos de auditoría sin copia del contenido de preguntas ni respuestas.

### Límites expresos
- **NO** se registra ninguna respuesta o información clínica.
- **NO** se habilita el formulario del paciente ni rutas públicas.
- **NO** se envían enlaces por WhatsApp o SMS.
- **NO** se toca Mercado Pago, suscripciones, calendario, reservas o perfiles.
- **NO** se ejecuta este SQL automáticamente en despliegues.
- Los `SECURITY DEFINER` tienen `search_path` vacío, control de `auth.uid()` y permisos revocados para anónimos.

## Verificación necesaria antes de activar

1. Revisar SQL, función por función, y pasar `node --test cithela/sql-review/form-templates-rpc-20261120.test.mjs`. **Estos tests son estáticos; NO ejecutan SQL.**
2. Aplicar en una base de desarrollo clonada o migración reversible con datos sintéticos, nunca directamente en CITHELA productivo.
3. Probar con JWT reales: owner/admin de A pueden editar A; operador/viewer/paciente y anónimos no; owner de B no puede ni listar ni modificar A.
4. Probar simultaneidad de versiones, dos formularios publicados del mismo servicio, servicio inactivo, payload malformado y reintentos de creación. Falta diseñar explícitamente la **idempotencia de alta** ante reintentos antes de habilitar producción.
5. Ejecutar asesores de seguridad y permisos y revisar `SECURITY DEFINER`. Definir política de conservación y archivado antes de guardar respuestas.
6. Recién después plantear integración en la ficha existente y un acceso de cliente verificado.

## Relación con PR #186

El [PR #186](https://github.com/SpukLab/spuklab-builds/pull/186) contiene el editor y la simulación local. Este trabajo es **independiente** y aún no los conecta.

La implementación clínica, recetas, odontogramas y consentimientos sanitarios específicos son otros productos/etapas, no parte de este módulo.
