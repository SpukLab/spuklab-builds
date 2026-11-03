# CITHELA — Comprobación segura de Mercado Pago (pruebas)

Fecha: 2026-11-03. Se añade un diagnóstico de conexión bajo petición, sin pagos.

## Preparación

El titular guardó el token de prueba como secreto `CITHELA_MP_TEST_ACCESS_TOKEN` en Supabase Edge Functions. Su valor no se consulta ni muestra en el navegador, ni se introduce en GitHub.

## Comprobación

La función `cithela-mp-test-connection` requiere JWT de Supabase y verifica en servidor que la persona autenticada tenga rol `owner` o `admin` en un establecimiento CITHELA. Después toma el secreto exclusivamente en memoria y consulta **GET https://api.mercadopago.com/preapproval/search**. No consulta con el token enviado por el navegador.

Devuelve únicamente `test_api_connected` o errores clasificados. Ignora y nunca devuelve facturas, datos del pagador o identificadores de suscripciones.

La acción aparece únicamente en **Configuración → Estado del servicio**, cuando se abre la aplicación con `?mpTest=1` y la sesión pertenece a titular/administrador. Los demás usuarios no ven un botón comercial nuevo.

El verificador realiza una **única lectura por pulsación**, no activa pagos, no registra webhooks y no mueve turnos ni cambia el estado `legacy`.

## Validación y despliegue

Los tests del repositorio comprueban el modo GET, rechazo de token ausente, errores de API, ausencia de fugas de secretos, autenticación, permisos de propietario y ocultamiento de la interfaz.

El despliegue se realiza con `verify_jwt=true`, separado de las funciones WhatsApp ya existentes. No se usa `verify_jwt=false`, no hay endpoint de notificaciones de pago activo y no se modifican las migraciones comerciales.

**Limitación:** el prefijo de un Access Token no demuestra por sí solo que pertenece al entorno de prueba. Se usa el secreto guardado explícitamente bajo `CITHELA_MP_TEST_ACCESS_TOKEN` y la comprobación confirma que Mercado Pago lo acepta para consultas; no debe usarse en producción sin verificar credenciales.

## Uso

1. Abrir la agenda en `https://spuklab.github.io/spuklab-builds/cithela/?mpTest=1` y entrar con la cuenta de profesional habitual.
2. Ir a **Configuración → Estado del servicio → Comprobar Mercado Pago de prueba**.
3. Verificar el resultado legible. La comprobación no solicita un cobro.

Documentación: [Mercado Pago — buscar suscripciones](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/search-preapproval/get).
