# DAHZEA · Web comercial centrada en operaciones (2026-10-30)

**Estado: propuesta para revisión. No publicada, no checkout y no acceso al panel operativo.**

## Objetivo

Reposicionar DAHZEA desde “bot de respuestas” hacia **gestión comercial y operativa para comercios que venden por Mercado Libre**, conservando la atención con IA como uno de sus módulos.

Página pública nueva: `hub/productos/dahzea/index.html`.

- Ventas: contexto, filtros y búsqueda sobre registros autorizados observados por DAHZEA; no se promete completitud absoluta respecto del Seller Center.
- Paquetería: búsqueda de productos, verificación, empaque y registro de evidencia fotográfica son tareas **internas**; no reemplazan las señales logísticas del marketplace.
- Cancelaciones y cambios: alertas y revisión humana antes de despachar; no prometemos bloqueo automático universal de cualquier envío cancelado.
- Envíos: estados, plazos y trazabilidad **observados** en Mercado Libre; no atribuir empaque físico al proveedor.
- Posventa: mensajes, reclamos, devoluciones e instrucciones supervisadas vinculadas a ventas mediante identidades explícitas.
- Asistente: consultas a conocimiento autorizado, respuestas supervisadas o automáticas **según habilitación** y derivación humana ante incertidumbre.

## Transparencia comercial

- La prueba anterior de “15 días” desaparece porque no existe evidencia suficiente aquí de una oferta vigente y autorizada.
- Multitenancy de DAHZEA, nuevos canales y contratación automática por Hub figuran como futuro, no habilitados.
- La demostración de tres pestañas es **estática y ficticia**, sin credenciales, datos de tiendas, APIs ni captura de leads.
- Se solicitan consultas por correo; nunca credenciales de Mercado Libre ni códigos por la página pública.
- DAHZEA privada en Render continúa aislada, sin enlaces públicos a su panel de operador.

## Publicación y fuentes

La landing anterior (`https://dahzea.dentrix-8m.chatgpt.site/`) pertenece a **ChatGPT Sites**. Esta propuesta **no la edita, despublica ni modifica**. La nueva página estática se alojaría junto al Hub en GitHub Pages al aprobar e integrar el PR; entonces la tarjeta del Hub enlazará a la nueva web.

Revisar antes de difusión: visual móvil, accesibilidad y copy comercial, disponibilidad anónima en GitHub Pages y políticas de privacidad/contacto. La tarjeta Hub y la nueva landing viajan en el mismo PR para evitar destinos rotos en producción.

**Fuentes de capacidades (repositorio interno separado `SpukLab/ai-commerce-assistant`):**
- `docs/OPERATOR-UI-INFORMATION-ARCHITECTURE-v1.md`
- `docs/MERCADOLIBRE-SHIPPING-VS-PACKING-BOUNDARY-2026-10.md`
- `docs/POST-SALE-WORKBENCH-v2.md`
- `docs/PILOT-READINESS-v1.md`
- `docs/MULTITENANT-READINESS-ANALYSIS-v1.md`
