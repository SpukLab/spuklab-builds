# CITHELA — operator signup checkpoint

Estado: preparado y validado el 2026-09-30.

## Objetivo

Permitir que el primer operador cree su cuenta Supabase Auth desde la propia CITHELA, ahora que existe una URL pública estable para la preview.

URL de retorno prevista:

`https://spuklab.github.io/spuklab-builds/cithela/`

## Flujo

En **Configuración → Nube CITHELA** se mantienen dos acciones separadas:

- **Conectar cuenta**: usa `signInWithPassword`.
- **Crear cuenta de operador**: usa `signUp` con `emailRedirectTo` fijado a la URL pública estable.

Si Supabase devuelve sesión inmediata, CITHELA refresca el workspace. Si la confirmación de email está activa, la UI indica que el operador debe confirmar desde su correo.

## Seguridad

- El navegador sigue usando únicamente la publishable key.
- No hay secret/service-role en el HTML.
- El alta no otorga acceso a ningún tenant existente.
- Tras confirmar la cuenta, el usuario sin membership sólo puede ejecutar el bootstrap controlado de su primer workspace.
- Persistencia visible continúa LOCAL; este checkpoint no activa remote-primary ni sincronización automática.

## Validación

- JavaScript parse: PASS.
- IDs HTML duplicados: 0.
- `CithelaCloud.signUp`: presente.
- Redirect estable: presente.
- Contraseña mínima en UI: 8 caracteres.
- El bridge existente de Auth/RLS no se modifica.

## Gate externo pendiente

En Supabase Auth debe permitirse la URL pública en **Authentication → URL Configuration** como Site URL y/o Redirect URL antes de probar la confirmación de correo.

Después: crear una cuenta real, bootstrap del workspace, configurar horarios y abrir la misma cuenta en dos dispositivos.
