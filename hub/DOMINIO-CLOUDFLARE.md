# SpukLab web · Preparación para dominio Cloudflare
Fecha: 30/10/2026 · Pendiente de dominio elegido.

## Estructura lista para usar

- Sitio público: raíz del repositorio `spuklab-builds/`, que redirige mediante enlace relativo a `/hub/`.
- Marca pública: **SpukLab**. El nombre interno de la carpeta `hub/` no aparece en la navegación comercial.
- Productos: `/hub/productos/cithela/`, `/hub/productos/dahzea/`; SURKARA permanece como tarjeta en la portada hasta crear su ficha.
- CITHELA operativa: `/cithela/`, independiente de la landing. DAHZEA operativa: fuera del sitio comercial.
- Todos los enlaces internos funcionan como rutas **relativas** para conservar navegación entre productos aunque cambie el dominio.
- No se agregó un archivo `CNAME` ni se configuraron DNS, redirecciones externas o certificados sin el dominio definitivo.

## Cuando esté definido el dominio

1. Elegir un host canónico (por ejemplo, dominio raíz o `www`). En GitHub, abrir **SpukLab/spuklab-builds → Settings → Pages → Custom domain** e introducir **el nombre real elegido**. No asignar un dominio de ejemplo.
2. En **Cloudflare → dominio → DNS → Records**, crear los registros según el host elegido y las indicaciones vigentes de GitHub Pages. Para subdominio, suele emplearse un **CNAME** dirigido a `spuklab.github.io`, no a la ruta `/spuklab-builds/hub/`. Para dominio raíz, seguir los A/AAAA o flattening que admita la configuración real. Durante la validación de GitHub Pages, preferir **DNS only** (nube gris) antes de activar proxy y opciones adicionales.
3. Verificar que GitHub muestre dominio validado y certifique **Enforce HTTPS** antes de difundir. Revisar acceso público, redirección desde raíz, menú móvil, páginas legales y ruta operativa de CITHELA sin exponer credenciales.
4. **Solo después de decidir el host canónico**, cambiar `og:url` y `link rel="canonical"` hoy asociados a `https://spuklab.github.io/spuklab-builds/...` en las tres páginas comerciales. Si corresponde, actualizar además `privacy.html` y `data-deletion.html` referidas desde productos.
5. Antes de conectar formularios de contratación o DAHZEA comercial real, implementar autenticación, autorización server-side, políticas de privacidad y pruebas de aislamiento por tenant/producto. Un dominio no añade seguridad de datos.

**Importante:** GitHub Pages sirve una web estática. No requiere Render ni otro proyecto Supabase para la presentación comercial. El dominio propio, la mensajería o los pagos son decisiones separadas.

Documentación oficial: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

## Validación de este cambio

`node --test hub/tests/commercial-pages.test.mjs` valida rutas estáticas y ausencia de secretos. `node hub/tests/browser-smoke.mjs` (desde CI con Playwright) prueba navegación móvil y escritorio. Las pruebas de aislamiento de CITHELA operativa continúan separadas.
