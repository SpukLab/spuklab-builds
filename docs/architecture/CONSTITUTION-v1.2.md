# SOUND FORGE 2 — ARCHITECTURE CONSTITUTION v1.2

**Status:** FROZEN
**Supersedes:** RFC-001 (drafts), RFC-002 (compliance audit), Constitution v1.1
**Changes from v1.1:** §4 PackBuilder (deriva, no inventa); Regla 11 agregada; nota de evolución en §4 MaterialEngine; §10 nuevo
**Open:** RFC-003 (Pack↔Fragment ownership), RFC-004 (Material Recipes)

*Esta Constitution define principios, no implementaciones. Es el criterio de revisión de toda decisión futura.*

---

## §1 — PROPÓSITO

Sound Forge 2 es un compilador de organismos sonoros. Recibe materia prima, la analiza, la transforma, construye organismos, y publica un SpukPack listo para SBO.

> **Sound Forge no produce fragmentos. Produce Packs.**

La pregunta que evalúa toda decisión futura:

> **¿Esto ayuda a producir un mejor SpukPack, o agrega complejidad fuera del dominio?**

---

## §2 — CAPAS DEL SISTEMA

Cuatro capas con responsabilidades disjuntas. Ninguna capa conoce a las capas que están por encima de ella.

```
Sound Forge    genera materia
Auto Forge     transforma materia
Pack Builder   organiza organismos
SBO            interpreta organismos
```

**Regla de oro:** si una función hace trabajo de dos capas distintas, viola la Constitution.

---

## §3 — MODELO DE DOMINIO

### §3.1 — Entidades

Tienen identidad que importa a lo largo del tiempo. Dos instancias con los mismos valores son entidades distintas si tienen `id` distintos.

---

**MATERIAL**

Una fuente de audio analizada con señales físicas objetivas y una identidad única.

Atributos canónicos:
```
id               — identificador único estable (nunca reutilizar)
name             — nombre del archivo fuente
buffer           — AudioBuffer decodificado
duration         — segundos
sampleRate       — Hz
channels         — canales
rms, peak        — amplitud
crestFactor      — ratio pico/RMS
transientProfile  — sharp | medium | smooth
spectralProfile   — low_heavy | balanced | bright
spectralCentroid  — Hz estimado
physicality      — 0..1
airContent       — 0..1
noiseFloor       — percentil 10 de amplitud
generation       — 0 = original; n = resultado de n render passes
damageLevel      — 0..1
```

Invariantes:
- Un Material no puede existir sin análisis físico completo
- `generation` se incrementa en cada RENDER PASS; nunca disminuye
- El buffer original se preserva si `generation=0`

---

**FRAGMENT**

Una unidad de materia sonora transformada, con identidad propia y linaje completo.

Atributos canónicos:
```
id               — identificador único estable
name             — nombre descriptivo
buffer           — AudioBuffer del fragmento (inmutable)
duration         — segundos
domain           — STRUCTURAL | ECOLOGICAL
materialType     — KICK | SNARE | HAT | PERC | TOM | IMPACT | ONE_SHOT
                   TEXTURE | DRONE | VOX | GLITCH | FX | ATMOS | RITUAL
slotType         — eje estético (dark_core, luminous_tail, etc.)
provenance:
  materialId     — id del Material origen
  sourceTrack    — nombre del archivo fuente
  sourceRegion   — {start, end} en segundos
  profile        — perfil DNA FORGE usado
  role           — ANCHOR | CONSERVATIVE | MODE_A | MODE_B | WILDCARD
  generation     — número de tanda de GENERATE
  cfg            — {ForgeState, FeelState} numérico en el momento de generación
  playback       — {mode, region, pitch, rate, reverse}
```

**Invariante fundamental: un Fragment es inmutable después de su creación.** Su buffer y su provenance no pueden modificarse. Si se necesita una variación, se crea un nuevo Fragment.

---

**PACK**

El organismo sonoro completo. Es el Aggregate Root del dominio.

Atributos canónicos:
```
id               — identificador único estable
name             — nombre del pack
blueprintRef     — referencia al Blueprint que lo originó
fragmentIds      — referencias a Fragments (ver RFC-003)
identity:
  dominantProfile       — derivado de provenance.profile de los Fragments
  materialDistribution  — derivado de materialType de los Fragments
  triggerModes          — derivado de materialType vía TYPE_TRIGGER
  materialRoles         — derivado de domain de los Fragments
  energyProfile         — derivado de provenance.cfg de los Fragments
  recommendedPhases     — derivado de provenance.playback.region de los Fragments
```

Invariante: un Pack no puede contener Fragments que no lo referencien.

> **Nota de implementación (§3.1):** la Constitution no prescribe cómo se implementa el Pack activo durante la sesión — puede ser un objeto global, una entrada en PackRepository, o parte de un objeto Session. Solo establece que **existe exactamente un Pack activo durante una sesión de producción** y que los Fragments se generan para ese Pack.

---

### §3.2 — Value Objects

No tienen identidad propia. Dos instancias con los mismos valores son intercambiables.

---

**BLUEPRINT**

La declaración de intención del organismo. Inmutable una vez declarado.

```
dominantProfile       — perfil DNA FORGE preferido
targetDistribution    — {materialType: cantidad objetivo}
targetDomain          — proporción STRUCTURAL / ECOLOGICAL
targetFragmentCount   — número objetivo de fragmentos
```

---

**RECIPE**

Una estrategia de transformación nombrada, expresada exclusivamente en el vocabulario de macros.

```
name          — identificador semántico
instructions  — {tone, space, damage, time, motion, precision, scale} → valores -1..1
```

**Regla:** una Recipe solo puede expresarse en vocabulario de `applyMacro()`. Si una transformación no es expresable como macros, el vocabulario se amplía primero. Ver RFC-004.

---

**INTERPRETATION**

El Value Object que conecta Auto Forge con Material Engine. Siempre nace completo — `cfg`, `playback` y `role` son inseparables y se producen en un único acto.

```
cfg       — {ForgeState, FeelState}: la dimensión de transformación
playback  — {mode, region, pitch, rate, reverse}: la dimensión de lectura
role      — ANCHOR | CONSERVATIVE | MODE_A | MODE_B | WILDCARD: la dimensión curatorial
```

Nunca existe un `cfg` sin un `playback` ni un `playback` sin un `role`. Si el código los produce por separado, viola la Constitution.

---

### §3.3 — Repositories de dominio

Colecciones de entidades con comportamiento de dominio propio. Se distinguen de la infraestructura porque pueden tener reglas de negocio.

**MaterialRepository**

Almacena y provee acceso a Materials disponibles. Puede incluir historial, materiales bloqueados, búsqueda por `transientProfile`, versiones derivadas. El tamaño y la implementación no están fijados por la Constitution.

**FragmentRepository**

Almacena Fragments. Filtrable por `packId`, `materialType`, `domain`, `profile`. Persiste entre sesiones.

---

### §3.4 — Infraestructura

Sin reglas de negocio. Solo mecanismos de persistencia, serialización, y síntesis.

```
IndexedDB     — persistencia de Fragments entre sesiones
ZIP           — serialización del SpukPack
Web Audio API — síntesis de audio; consumida exclusivamente por MaterialEngine
```

---

## §4 — MOTORES (Domain Services)

Funciones sin estado propio. Reciben entidades o Value Objects, devuelven entidades o Value Objects transformados. Reemplazables sin modificar otras capas si respetan la misma interface.

---

**AnalyzeMaterial** `(AudioBuffer, name) → Material`

Función pura. Sin side effects. Sin estado. Nadie más puede derivar señales físicas de un Material.

---

**InterpretationSelector** `(Material, Blueprint, CuratorialRole) → Interpretation`

Devuelve una `Interpretation` completa: `{cfg, playback, role}`. La Constitution no prescribe dónde vive en el código — solo que produce `Interpretation` como unidad inseparable.

---

**MaterialEngine** `(Material, Interpretation, ...) → AudioBuffer`

Traduce una `Interpretation` en audio. Internamente aplica el `cfg` vía `applyMacro()`, escribe en states, invoca la cadena DSP. Nunca recibe parámetros DSP crudos directamente.

> **Nota de evolución:** la firma mínima es `(Material, Interpretation)`. La Constitution no congela el número de parámetros — solo establece que MaterialEngine recibe exactamente lo que necesita para producir audio. En el futuro puede recibir un tercer parámetro `Context` que incluya temperatura del organismo, estado del Pack, memoria, u otros factores. Ese cambio no requiere una nueva RFC mientras MaterialEngine siga siendo un motor sin estado propio.

---

**PackBuilder** `(FragmentRepository, Blueprint) → Pack`

Función pura. Sin I/O. **Deriva** la identidad del Pack a partir de información que ya existe en los Fragments — no inventa atributos, no toma decisiones creativas. Cada campo de `Pack.identity` es una agregación o derivación directa de atributos ya presentes en `Fragment.provenance`, `Fragment.materialType`, o `Fragment.domain`. PackBuilder nunca es un motor inteligente: es un motor de agregación.

Evalúa si el Pack cumple el Blueprint. Devuelve el Pack con su identidad declarada. No produce ningún archivo.

---

**Export** `(Pack, FragmentRepository) → SpukPack`

Solo I/O. Sin lógica de negocio. No calcula nada. No decide nada.

---

## §5 — AUTO FORGE (Orquestador)

Auto Forge coordina la secuencia de motores. No toma decisiones de dominio.

```
lee:    MaterialRepository (qué material hay disponible)
lee:    FragmentRepository vs Blueprint (qué falta para completar el Pack)
llama:  InterpretationSelector
llama:  MaterialEngine
llama:  saveFragment() → escribe en FragmentRepository
```

**Regla:** Auto Forge no impone `domain`, `materialType` ni ningún atributo del Fragment. Esos valores los determina el Blueprint o el curador. Auto Forge los lee, no los escribe.

---

## §6 — FLUJO CANÓNICO

```
BLUEPRINT (declarado antes de la primera generación)
      │
      ▼
AUTO FORGE (orquestador)
  ├─ consulta MaterialRepository + FragmentRepository + Blueprint
  ├─ selecciona Material
  ├─ invoca InterpretationSelector → Interpretation
  ├─ invoca MaterialEngine(Material, Interpretation) → AudioBuffer
  └─ invoca saveFragment() → Fragment en FragmentRepository
      │
      ▼  (cuando el Pack está completo)
PACK BUILDER (FragmentRepository + Blueprint → Pack)
      │
      ▼
EXPORT (Pack → SpukPack)
      │
      ▼
SBO
```

---

## §7 — REGLAS

**1.** Fragment es inmutable después de `saveFragment()`. No hay excepciones.

**2.** Los motores no tienen estado propio. Todo el estado vive en entidades o repositories.

**3.** Auto Forge no decide `domain` ni `materialType`. Esos valores los determina el Blueprint o el curador.

**4.** Export no toma ninguna decisión. Si hay lógica de negocio en Export, pertenece a PackBuilder.

**5.** Un Pack activo existe antes del primer Fragment. Los Fragments se generan para un Pack.

**6.** Recipe solo usa vocabulario de macros. Si no es expresable como macros, el vocabulario se amplía primero.

**7.** Interpretation siempre nace completa. `cfg`, `playback` y `role` son inseparables.

**8.** SBO nunca adivina. Todo lo que SBO necesita para interpretar un Pack viaja dentro del SpukPack.

**9.** Un motor no conoce al orquestador. La dependencia es unidireccional: Auto Forge → motores.

**10.** Una sola fuente de verdad por concepto. Si dos capas mantienen la misma información, una está mal ubicada.

**11.** Ninguna entidad del dominio conoce componentes de interfaz. Material, Fragment, Pack, Blueprint, Recipe e Interpretation no pueden depender de botones, paneles, sliders, DOM, ni estados visuales. La UI consume el dominio; el dominio no conoce la UI.

---

## §8 — RFCS ABIERTAS

**RFC-003 — Modelo de pertenencia Pack↔Fragment** *(pendiente)*

Tres modelos posibles con implicaciones distintas para SBO y para la reutilización de Fragments:

- **Modelo A:** `Fragment.packId` — pertenencia exclusiva a un Pack
- **Modelo B:** `Pack.fragmentIds` — muchos a muchos
- **Modelo C:** Pack contiene Referencias `{fragmentId, weight, phase, role, probability}` — permite reutilizar Fragments en múltiples organismos con roles distintos

La Constitution actual no prescribe ninguno. Toda implementación que establezca una de las tres opciones requiere abrir RFC-003 antes del commit.

**RFC-004 — Material Recipes** *(pendiente)*

El vocabulario completo de Recipes como Value Objects: nombres canónicos del catálogo inicial, instrucciones en vocabulario de macros, y la capa de síntesis de colisiones (cuando dos macros de la misma Recipe tocan el mismo campo DSP).

---

## §9 — CONSTITUTION COMPLIANCE

Toda implementación nueva se evalúa contra esta Constitution antes de mergearse. Las preguntas de revisión:

1. ¿Este componente pertenece a una entidad, un Value Object, un motor, o un repository? ¿Está en la capa correcta?
2. ¿Algún motor asume estado entre invocaciones?
3. ¿Export hace algo que no sea serializar?
4. ¿Auto Forge decide algo que debería decidir el Blueprint?
5. ¿Algún Fragment se modifica después de `saveFragment()`?
6. ¿PackBuilder inventa atributos, o los deriva de datos que ya existen en los Fragments?
7. ¿Alguna entidad del dominio tiene dependencias sobre la UI?
8. ¿El resultado ayuda a producir un mejor SpukPack, o agrega complejidad fuera del dominio?

---

## §10 — EVOLUCIÓN DE LA CONSTITUTION

La Constitution define principios, no implementaciones. Una implementación puede cambiar libremente si continúa respetando los principios.

Cuando una implementación obliga a modificar un principio, deberá abrirse una nueva RFC antes de cualquier commit. La Constitution nunca se modifica de forma implícita mediante código.

Las RFCs abiertas (RFC-003, RFC-004) son las únicas áreas donde la Constitution no prescribe todavía una respuesta. Toda otra decisión tiene una respuesta en §3 a §9.

---

*CONSTITUTION v1.2 — FROZEN*
*Sound Forge 2 — SpukLab*
