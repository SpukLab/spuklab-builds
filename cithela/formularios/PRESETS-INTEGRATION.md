# CITHELA · Biblioteca de formularios iniciales (prototipo, 2026-11-22)

## Objetivo
Reducir el tiempo para configurar un formulario por servicio, sin agregar una segunda agenda ni directorio de clientes. El profesional parte de una plantilla breve y puede modificarla antes de la vista previa.

Este PR está **apilado sobre el PR #186**. El PR #189 (solicitud → cliente → ficha) es otro trabajo apilado sobre #186 y NO se modifica aquí. El PR #187 mantiene el SQL de plantillas independiente, sin aplicación. El circuito de Mercado Pago no interviene.

## Incluido

- Selector «Empezar con una plantilla» junto al editor existente.
- Cuatro modelos: **contacto y preferencias**, **peluquería**, **tatuajes**, **asesoría general**.
- Filtro editorial por actividad: en la demostración de consultorio aparecen solamente las opciones transversales, nunca formularios clínicos.
- Botón «Usar plantilla» crea un borrador del servicio y establecimiento seleccionados.
- Las preguntas siguen siendo editables o eliminables con el editor v1; la publicación continúa siendo una simulación en memoria.
- Protección contra reemplazo accidental de un borrador con preguntas.
- Pruebas automáticas para actividad, estructura, edición, privacidad, aislamiento entre establecimientos, ausencia de accesos externos y compatibilidad con el modelo v1.

## No incluido

- No genera formularios médicos, consentimientos sanitarios, recetas, archivos adjuntos ni historias clínicas.
- No solicita datos reales ni los almacena; una respuesta libre podría contener datos sensibles, por eso el piloto real requiere restricciones y revisión de privacidad.
- No publica nuevas funciones en Supabase ni modifica `cithela/index.html`, WhatsApp, agenda, pagos, comercialización o suscripciones.
- No registra ni envía respuestas a clientes reales.

## Integración futura

1. Aprobar el modelo de formularios (#186), este catálogo y el circuito de solicitud (#189), resolviendo la compatibilidad entre ramas antes de fusionarlas.
2. Validar el SQL de plantillas (#187) en una base de prueba con RLS y usuarios reales simulados; no aplicar su SQL directamente en producción.
3. Conectar `Configuración → Servicios → Formularios` a la biblioteca. Al guardar, mapear cada borrador a `tenant_id + service_id` de CITHELA.
4. Conectar la solicitud al portal autenticado y mostrar respuestas desde `Clientes/Pacientes → Ver ficha`, con permisos propios, finalidad, retención y eliminación.
5. Comprobar iPhone/iPad/escritorio con datos sintéticos. Habilitar gradualmente, sin dependencia del checkout de Mercado Pago.

## Verificación

```bash
node --test cithela/formularios/form-model.test.mjs cithela/formularios/isolation.test.mjs cithela/formularios/presets.test.mjs
```

Para observar la maqueta abrir `cithela/formularios/index.html` desde un servidor estático. No abrir el archivo como `file://` en navegadores que bloquean módulos ESM.

**Pendiente para habilitar en producción:** UX integrada, seguridad del backend y control de datos personales.