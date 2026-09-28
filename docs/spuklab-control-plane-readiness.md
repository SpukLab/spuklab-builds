# SpukLab — Autonomous Products / Future Control Plane

Estado: diseño objetivo. No introduce dependencia de ejecución entre productos.

## Principio

Los productos deben poder funcionar y venderse de forma autónoma antes de existir una plataforma central completa.

Ejemplos:
- Turnos: agenda, servicios, recursos y WhatsApp.
- SURKARA: operación rural.
- DAHZEA: comercio conversacional y automatización.

La integración futura no debe convertir a DAHZEA en una dependencia técnica obligatoria de cada producto. DAHZEA puede evolucionar hacia un **control plane** o formar parte de una plataforma SpukLab que administre tenants, usuarios, suscripciones, productos y conectores.

## Arquitectura objetivo

```text
                    SpukLab Web / Control Plane
                 ┌───────────────────────────────┐
                 │ Cuenta / organización        │
                 │ Tenant                       │
                 │ Usuarios y roles             │
                 │ Suscripciones / cobros       │
                 │ Productos habilitados        │
                 │ Conectores                   │
                 │ Estado de provisión          │
                 └──────────────┬────────────────┘
                                │ entitlements / identity
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
     Turnos                  DAHZEA                 SURKARA
        │                       │                       │
   WhatsApp/API            ML/WhatsApp/...        Campo/offline/...
```

Cada satélite conserva:
- su dominio;
- su persistencia operativa;
- sus reglas;
- su disponibilidad;
- su capacidad de degradar o seguir funcionando cuando el control plane no esté disponible.

## Responsabilidades futuras del Control Plane

### Tenant / organización
Identidad estable para cada cliente comercial.

Campos conceptuales:
- `tenantId`
- `displayName`
- `status`: active | suspended | closed
- locale / timezone
- metadata comercial mínima

### Usuarios y roles
El control plane administra identidad y acceso global.

Ejemplos:
- owner
- admin
- operator
- viewer

Cada producto puede mapear esos roles a permisos propios.

### Catálogo de productos
Ejemplos:
- `turnos`
- `dahzea`
- `surkara`
- futuros productos

### Entitlements
La aplicación no debería consultar facturación directamente para cada acción.

Contrato conceptual:

```text
Entitlement {
  tenantId
  productKey
  status
  planKey
  features[]
  validUntil?
}
```

El producto recibe o consulta entitlements y decide qué capacidades habilitar.

### Suscripciones y cobros
La lógica de cobro vive fuera de los productos satélite.

El control plane podrá:
- iniciar prueba;
- activar plan;
- registrar renovación;
- suspender por falta de pago;
- cambiar plan;
- administrar addons.

Los satélites no deben contener lógica específica del proveedor de pagos.

### Provisioning
Alta/baja de una instancia o espacio de producto.

Contrato conceptual:

```text
ProvisionProduct {
  tenantId
  productKey
  configuration
}

ProvisionResult {
  productInstanceId
  status
  accessUrl?
}
```

### Conectores
WhatsApp, Mercado Libre u otros canales deben vincularse al tenant y producto correspondiente sin exponer secretos al navegador.

El control plane puede administrar:
- conexión;
- autorización;
- expiración;
- estado;
- referencia a secretos.

Los secretos reales deben almacenarse en infraestructura segura del backend, no en HTML/localStorage.

## Estrategia para Turnos

### Ahora
Turnos permanece completamente autónomo:
- marca configurable;
- servicios;
- recursos/profesionales;
- agenda;
- WhatsApp manual;
- backup portable;
- operación local.

### Próxima etapa autónoma
Backend propio de Turnos:
- almacenamiento multiusuario;
- autenticación;
- concurrencia real;
- API de agenda;
- webhook/adaptador oficial de WhatsApp.

Turnos puede venderse y operar sin DAHZEA.

### Integración posterior
Cuando exista el control plane:
- se asigna un `tenantId`;
- se crea un `productInstanceId`;
- se reciben entitlements;
- los usuarios pueden entrar desde un portal común;
- la suscripción habilita/deshabilita capacidades;
- WhatsApp puede contratarse como producto o addon;
- DAHZEA puede consumir la API de Turnos sin ser su runtime.

## WhatsApp como capacidad independiente

WhatsApp debe modelarse como integración/canal, no como parte inseparable de DAHZEA.

Posibles combinaciones comerciales:

```text
Turnos
Turnos + WhatsApp
DAHZEA
DAHZEA + WhatsApp
Turnos + DAHZEA + WhatsApp
SURKARA
...
```

Esto permite vender productos y addons sin forzar un paquete único.

## Reglas de desacoplamiento

1. Ningún satélite depende de una sesión de DAHZEA para iniciar.
2. Billing no vive dentro del dominio de Turnos/SURKARA.
3. Los IDs locales actuales no se reemplazan por `tenantId` hasta disponer del backend adecuado.
4. Los productos deben aceptar una identidad de tenant externa en el futuro.
5. La suspensión comercial no debe corromper ni borrar datos del producto.
6. Los secretos de conectores no se guardan en frontend.
7. Los eventos entre productos deben usar contratos versionados.
8. Cada producto debe poder evolucionar y desplegarse de forma independiente.
9. La web central administra acceso y contratación; no absorbe el dominio interno de cada producto.
10. DAHZEA puede actuar como orquestador/cliente de otros productos, no como autoridad sobre sus datos de dominio.

## Portal comercial futuro

Flujo objetivo:

```text
Registro
  → Crear organización
  → Elegir producto
  → Prueba / suscripción
  → Provisionar
  → Conectar canal (opcional)
  → Invitar usuarios
  → Operar
```

Desde la misma web el cliente debería poder ver:
- productos contratados;
- estado de suscripción;
- próximos cobros;
- usuarios;
- integraciones;
- acceso a cada producto;
- soporte/configuración básica.

## Preparación que sí conviene hacer ahora

- mantener contratos de dominio limpios;
- evitar nombres específicos de un vertical;
- versionar backups y eventos;
- preservar IDs propios del producto;
- separar canales de mensajería;
- documentar qué datos serán tenant-scoped;
- no introducir billing/auth central prematuramente.

## Preparación que no conviene hacer todavía

- agregar `tenantId` ficticios al HTML local;
- duplicar lógica de facturación en cada producto;
- hacer que Turnos consulte DAHZEA para funcionar;
- almacenar tokens de WhatsApp en frontend;
- crear un mega-repositorio que mezcle los dominios.

La integración se realizará cuando exista infraestructura real que justifique esos contratos.
