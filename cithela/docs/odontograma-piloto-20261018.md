# CITHELA · módulo odontológico opcional — piloto 2026-10-18

## Decisión de producto
CITHELA sigue siendo una plataforma multirrubro de agenda, autogestión y comunicación. La ficha clínica y el odontograma son una extensión opcional para espacios configurados como **odontología**. No se agrega navegación clínica al portal de peluquería, tatuajes u otros rubros.

## Prototipo de interacción incluido
Archivo: [odontograma-demo.html](../odontograma-demo.html).

- Odontograma permanente FDI: 32 piezas (11–18, 21–28, 31–38, 41–48), organizado por cuadrante.
- Selección táctil de pieza, superficies vestibular, lingual/palatina, mesial, distal, oclusal/incisal y pieza completa.
- Marcas visuales de caries, restauración, tratamiento pendiente/realizado y pieza ausente; opción de corrección sin borrar los eventos anteriores.
- Historial en memoria, notas de prueba de longitud limitada, carga de datos ficticios y reinicio.
- No recopila datos identificatorios ni clínicos reales; no hace consultas remotas, no emplea localStorage y se reinicia al recargar.
- No está vinculado al login de CITHELA ni a un paciente. **No usar clínicamente.**

## Integración propuesta (no implementada)
1. **Habilitación de rubro y roles:** pantalla "Historia clínica" visible solamente para establecimientos odontológicos y profesionales autorizados, nunca para el portal de pacientes ni personal sin permiso clínico.
2. **Ficha mínima:** enlazar a una persona del mismo tenant (tenant_id + person_id), visualizando antecedentes consensuados, consultas y odontograma. No copiar datos clínicos a WhatsApp, correos, logs, analítica ni datos públicos.
3. **Modelo persistente:** eventos clínicos append-only (tenant/persona/pieza/superficie/tipo/nota/autor/fecha) y proyección vigente para la UI; correcciones como nuevos eventos con referencia al original. Vincular tratamientos propuestos a un catálogo y presupuesto solo en fases posteriores.
4. **Seguridad:** esquema y RLS restrictivos por tenant y rol específico; operaciones de escritura en servidor con comprobación de permisos, límites de payload, bloqueo de sobrescritura, auditoría de accesos y cambios. No dar acceso por defecto a todo usuario con rol operator del tenant.
5. **Privacidad:** consentimiento/información adecuada para datos de salud, retención y eliminación, exportación/portabilidad, copias cifradas y revisión de normativa aplicable en Argentina antes de incorporar pacientes reales. Separar los adjuntos clínicos de los comprobantes de seña.
6. **Validación:** revisión odontológica de catálogo y nomenclatura antes de usar la UI profesional, controles de concurrencia en dos dispositivos y pruebas de aislamiento inter-tenant/paciente.

## Orden de trabajo
- **P0** mantener estable el circuito actual: turnos, disponibilidad, confirmación y autenticación WhatsApp.
- **P1** validar ergonomía del odontograma con profesional piloto y ajustar piezas/superficies/leyendas. Añadir dentición temporal (20 dientes, FDI 5–8) si el consultorio atiende niños.
- **P2** integrar ficha clínica, API y almacenamiento con seguridad completa; luego evolucionar a tratamientos y presupuestos.
- **Fuera de alcance** recetas electrónicas, diagnósticos por IA o interpretación clínica automática.

## Criterios de aceptación para pasar a producción
- Profesional piloto aprueba nomenclatura, orientación de caras, controles y significado de las marcas.
- Ningún dato clínico puede verse/editarse desde otro tenant, desde el portal paciente ni con un rol operativo sin permiso.
- Persistencia multi-dispositivo con auditoría, corrección sin pérdida de historia y pruebas automatizadas.
- Flujo principal de CITHELA permanece separado, sin degradación para rubros no odontológicos.

Este documento y el prototipo no alteran la aplicación principal ni provisionan tablas o permisos en Supabase.
