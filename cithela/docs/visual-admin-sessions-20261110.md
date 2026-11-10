# CITHELA · identidad aprobada y sesiones administrativas · 10/11/2026

Los dos JPEG adjuntos por Denis son la fuente canónica: brand/source, con hashes en brand/approved-assets.json. Exportaciones sin recorte ni redibujo. SVG autocontenido con raster, PNG 32/180/192/512 y manifiestos distintos para app y administración. Los antiguos mask-icon no se anuncian para evitar otra silueta no aprobada. La pantalla de acceso y el encabezado usan el mismo icono comercial; los logos particulares de establecimientos no se modifican.

Administración e Invitaciones usan storageKey `cithela-platform-admin-auth-v1`, independiente de la clave profesional. Inicio por contraseña en la propia pantalla, sin copiar tokens profesionales ni aceptar sesiones del fragmento de URL. Cierre administrativo con scope local; no invalida las otras sesiones. Las funciones privadas siguen resolviendo el JWT en Auth y comprobando el UID administrativo; la clave local no otorga permisos.

Verificación local: 35/35 pruebas de iconos, sesión, consola, invitaciones, enlaces, trial y estado comercial. Incluye aislamiento de almacenes y reintentos del panel. Supabase solo lectura: 4 establecimientos, 4 membresías y 2 pruebas activas; 0 grants pendientes. RPC administrativas y de invitaciones no ejecutables por authenticated. No se alteraron agendas, reservas, Auth ni Edge Functions.

Pendiente: verificar el login administrativo con credencial real en Safari iPhone/iPad/escritorio y la conservación de sesiones profesionales. Este entorno no acredita Safari real ni entrega de correos. No se activa alta abierta, cobros o limpieza.
