# CITHELA — Product Identity v1

Estado: nombre de trabajo consolidado para el producto de agenda/turnos de SpukLab.

## Decisión

**CITHELA** es la marca visible del producto.

El motor conserva nombres técnicos históricos como:
- `TurnosDomain`;
- `TurnosChannel`;
- claves locales `cl_*`;
- schema de backup `turnos-local-backup`.

No deben renombrarse solo por branding si eso agrega riesgo de migración sin beneficio funcional.

## Alcance del producto

CITHELA es una agenda operativa reutilizable para servicios por cita:
- odontología;
- peluquería/barbería;
- tatuajes;
- estética y bienestar;
- otros servicios con profesional/recurso, duración y disponibilidad.

La especialización por rubro pertenece a configuración/presentación, no a forks del motor.

## Canales

CITHELA debe funcionar como producto autónomo.

Canales previstos:
- UI web;
- WhatsApp directo;
- API;
- DAHZEA como cliente/orquestador futuro;
- portal/control plane SpukLab futuro.

WhatsApp es un adaptador de canal y no la autoridad del turno.

## Integración futura

Identificadores conceptuales:
- `productKey = cithela`;
- `tenantId` provisto por el futuro control plane;
- `productInstanceId` por instancia provisionada.

DAHZEA no es una dependencia de ejecución.

## Gate de marca antes de lanzamiento público

CITHELA sigue siendo nombre de trabajo hasta completar el gate formal:
1. búsqueda exacta y fonética en INPI y registros relevantes;
2. revisión de clases Niza aplicables (especialmente 35, 42 y 9);
3. verificación de dominios, apps, software y usos comerciales;
4. presentación de solicitud para asegurar prioridad antes de una campaña pública importante.

El historial Git/commits sirve como evidencia cronológica del desarrollo, pero no reemplaza derechos marcarios.
