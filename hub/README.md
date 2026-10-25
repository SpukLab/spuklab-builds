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

## DAHZEA: sitio comercial externo

La tarjeta DAHZEA enlaza a la landing creada anteriormente en ChatGPT Sites:
https://dahzea.dentrix-8m.chatgpt.site/

Esta landing comercial con demostración interactiva es independiente de la app operativa privada en Render y no expone su panel de operador ni credenciales. En el Hub se conserva un enlace alternativo por correo para consultas sobre el piloto.

**Validación de publicación pendiente:** comprobar desde navegador de incógnito (sin cuenta del propietario) que la configuración de compartir del ChatGPT Site permita acceso público. El metadato de la biblioteca mostraba estado activo pero acceso personalizado; no asumir disponibilidad anónima hasta probarlo. Si está restringida, ajustar la audiencia desde el Site original en ChatGPT antes de difundir el enlace.
