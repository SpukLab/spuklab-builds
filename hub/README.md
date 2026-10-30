# SpukLab Hub — sitio institucional (v0.1)

Landing estática y responsive de SpukLab Hub. No incluye autenticación, bases de datos, contratación automática ni funciones multitenant; presenta la visión y los productos en piloto/desarrollo.

## URL pública

https://spuklab.github.io/spuklab-builds/hub/

Se publica mediante GitHub Pages desde la rama `main` y la raíz del repositorio, sin build ni dependencias. Enlaces legales (privacidad y eliminación) se resuelven de forma relativa a la raíz existente.

## Próximos pasos hacia la plataforma

1. Consolidar sitio institucional y dominio propio, con identidad visual definitiva.
2. Diseñar autenticación y roles del Hub: cliente, equipo, profesional/operador y administración.
3. Modelar organizaciones, tenencia de productos, membresías y configuraciones multitenant.
4. Integrar CITHELA y DAHZEA manteniendo sus sistemas de autorización y datos aislados; luego SURKARA.
5. Incorporar onboarding seguro de WhatsApp/Mercado Libre, contratación, facturación y soporte según etapa comercial.

**Seguridad:** el HTML no incluye llaves ni credenciales. No confundir esta landing con el panel operativo de los productos. Actualizar contenido al pasar de piloto a producción.

## Catálogo de páginas comerciales (propuesta en revisión)

En el mismo GitHub Pages, sin nuevo backend:

- **Hub:** `/hub/` (catálogo institucional y enlaces a las páginas comerciales).
- **CITHELA:** `/hub/productos/cithela/` (web informativa, consulta de piloto y acceso separado a `/cithela/`).
- **DAHZEA:** `/hub/productos/dahzea/` (ventas, paquetería, postventa, atención con IA y demo ficticia). El panel operativo de Render **no** se publica ni enlaza.
- **SURKARA:** pendiente de ficha propia. Conserva su tarjeta informativa en el Hub.

Estas nuevas rutas funcionarán públicamente **solo después de integrar y desplegar la rama**; no confundir el PR con publicación.

La web anterior de DAHZEA en ChatGPT Sites (https://dahzea.dentrix-8m.chatgpt.site/) sigue existiendo independientemente. Este cambio no la edita ni modifica su acceso; reemplaza únicamente el destino de la tarjeta del Hub al integrarse.

## Protección y mantenimiento

- Se comparten marca y navegación, **no** datos entre productos ni organizaciones.
- No hay registros públicos, cobros, claves privadas, acceso al panel DAHZEA, conexión a APIs de tiendas ni chatbot comercial real.
- Las demostraciones comerciales son ficticias; no utilizar capturas de tiendas sin autorización o con datos personales.
- Las habilitaciones futuras deben hacerse desde servidor y con autorización por producto/tenant.
- Las pruebas automáticas `node --test hub/tests/commercial-pages.test.mjs` revisan enlaces, delimitación de funcionalidades y ausencia de credenciales en las páginas. No reemplazan la inspección visual de iPhone/iPad ni las pruebas de aislamiento multitenant de CITHELA.

Ver `hub/ARQUITECTURA-COMERCIAL.md` y las instrucciones específicas `hub/productos/dahzea/README.md`.
