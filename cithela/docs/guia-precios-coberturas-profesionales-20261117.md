# CITHELA · Tarifas de consultas y coberturas · piloto controlado (17/11/2026)

## Qué puede probar el profesional
En su cuenta real puede abrir **Ajustes → Reservas online → Precios y coberturas**, cuando SpukLab haya marcado el módulo Salud como solicitado/piloto/activo, o acceder al enlace directo `/cithela/configurar-coberturas.html` tras iniciar su sesión profesional.

1. Elegir establecimiento y servicio (consulta, control, sesión), manteniendo las duraciones de la agenda.
2. Elegir Particular / Obra social / Prepaga y escribir entidad y plan aceptados. No ingresar número de afiliado ni datos clínicos.
3. Definir importe ARS orientativo **que pagaría el paciente** o «A confirmar», y fecha de vigencia del convenio.
4. Guardar. Puede modificar, desactivar y reactivar. CITHELA controla versiones para evitar sobrescrituras entre sesiones.

**La tarifa se guarda realmente en Supabase**, ligada al establecimiento. Sin permiso Salud efectivo sigue en modo borrador y no se muestra a pacientes.

## Qué verá el paciente cuando el piloto esté expresamente habilitado
- En `reservar.html`, tras elegir el servicio: Particular / Obra social / Prepaga → Entidad y plan aceptados → importe orientativo o «a confirmar», antes del día y horario.
- Para seguro/prepaga: debe aceptar expresamente compartir la cobertura y el plan **solo para gestionar el turno**. No se le pide número de afiliado ni documentación.
- El servidor comprueba la tarifa y la versión al confirmar la solicitud. Si el convenio cambió, no acepta un precio anterior.
- La elección y el precio se guardan en una tabla privada, como snapshot de ese turno, **sin autorización automática ni cobro**.
- Los turnos comunes, incluso cuando la lista de coberturas está vacía, usan el flujo existente. Los establecimientos no habilitados no ven ningún selector sanitario.

## Política comercial
Paquetes de SpukLab (Presupuestos, Salud, Taxes, SMS) **no son** los precios de consultas. El precio que contrata el profesional a SpukLab se administra por cuenta en la consola comercial y no pasa al paciente. El campo «seña» de CITHELA sigue siendo independiente.

El módulo Salud requiere a la vez: paquete marcado `available=true` en el catálogo global, autorización para ese tenant `pilot` o `active`, vigencia, agenda pública habilitada y acceso comercial vigente. **Sin todos los requisitos es invisible al paciente.** No conceder a todos los tenants por defecto.

## Verificaciones
- SQL instalado: `cithela_health_rates_live_20261117`, `cithela_health_consent_20261117`; sin afectar tarifas, turnos o cuentas previas.
- Funciones nuevas separadas del guard de reservas vigente.
- Ensayo SQL dentro de transacción revertida: alta/edición de tarifa, control de versión, bloqueo cross-tenant y módulo apagado.
- Pruebas GitHub Actions de validación RPC, roles, formulario y navegación simulada en Chromium móvil sin red.
- Para el piloto real quedan pendientes confirmación del profesional, política de privacidad/retención, pruebas iPhone Safari con correo verificado y una reserva ficticia supervisada contra un establecimiento identificado.

## Reversibilidad
Desactivar `cithela_package_catalog.available` para Salud o cambiar el grant del tenant a `disabled` hace desaparecer su selector del portal público, manteniendo los presupuestos y turnos históricos. No eliminar las tablas ni datos por vencimiento.

La plantilla de consentimientos no reemplaza asesoramiento sobre Ley argentina 25.326 para datos vinculados con salud.
