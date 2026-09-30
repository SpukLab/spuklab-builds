# CITHELA — controlled multi-device cloud probe

Estado: preparado y validado el 2026-09-30.

## Objetivo

Probar que dos dispositivos conectados al mismo workspace ven el mismo estado remoto antes de activar remote-primary.

## Flujo

En **Configuración → Nube CITHELA → Prueba multi-dispositivo** un owner/admin/operator puede:

1. elegir servicio, recurso y fecha cloud;
2. consultar disponibilidad autoritativa;
3. resolver/crear explícitamente una persona de prueba por teléfono E.164;
4. crear un turno únicamente en Supabase mediante los RPC controlados;
5. refrescar el estado cloud;
6. comparar el contador de turnos cloud desde un segundo dispositivo.

La agenda local no se modifica.

## Lecturas remotas

El bridge cloud refresca hasta 100 turnos del tenant mediante SELECT protegido por RLS. No se agregaron grants nuevos: `authenticated` ya tenía SELECT sobre appointments/people/services/resources y RLS limita el tenant visible.

## Escrituras remotas

No se escriben tablas directamente.

- persona: `cithela_directory_command / person.resolve`
- disponibilidad: `cithela_availability_query`
- turno: `cithela_reservation_command / appointment.create`

## Tiempo

El navegador convierte fecha/hora local del tenant a un timestamp ISO absoluto usando el timezone IANA del workspace antes de enviar el comando.

Checks manuales del convertidor:

- Buenos Aires 09:00 → 12:00Z
- New York invierno 09:00 → 14:00Z
- New York verano 09:00 → 13:00Z

## Validación

- JavaScript parse: PASS.
- IDs HTML duplicados: 0.
- panel de prueba: presente.
- creación remota: presente.
- conversión timezone: verificada.
- no cambia persistencia activa de la agenda: continúa LOCAL.

## Criterio para aprobar el gate

El mismo operador inicia sesión en dos dispositivos.

- Ambos muestran el mismo workspace.
- Ambos muestran los mismos servicios, recursos y horarios.
- Se crea un turno cloud de prueba en el dispositivo A.
- Tras **Probar conexión** en B, el contador remoto coincide.
- La disponibilidad del slot ocupado desaparece en ambos.

Sólo después de este gate se debe considerar remote-primary.
