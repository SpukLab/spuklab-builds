# CITHELA — cloud working hours UI checkpoint

Estado: preparado y validado el 2026-09-30.

## Objetivo

Permitir que un owner/admin configure los horarios generales del workspace remoto desde la propia app, sin entrar al dashboard de Supabase.

## Alcance UI

En **Configuración → Nube CITHELA** aparece **Horarios cloud** únicamente cuando:

- existe sesión cloud;
- existe workspace;
- el rol es `owner` o `admin`.

La vista permite definir hasta dos tramos generales por día. Dejar ambos tramos vacíos cierra el día.

Los horarios específicos de un profesional/recurso no se modifican desde esta vista.

## Backend reutilizado

La UI llama al RPC ya existente:

`cithela_configuration_command(..., 'working_hours.set_day', ...)`

No agrega escrituras directas a tablas y no modifica el modelo de autorización existente.

Cada guardado usa un request id nuevo para conservar idempotencia del backend.

## Protección de datos

Si un día ya tiene más de dos tramos generales, la pantalla lo detecta y deshabilita el guardado para evitar perder configuración avanzada.

## Validación

- JavaScript parse: PASS.
- IDs HTML duplicados: 0.
- panel cloud presente.
- wrapper `working_hours.set_day` presente.
- persistencia visible continúa LOCAL.
- remote-primary sigue desactivado.

## Siguiente gate

Con URL/Auth configurados:
1. crear/conectar operador;
2. bootstrap del workspace;
3. configurar horarios cloud;
4. comprobar el mismo workspace desde dos dispositivos;
5. recién después evaluar remote-primary.
