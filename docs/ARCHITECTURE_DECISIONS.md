# BEATSONE — ARCHITECTURE DECISION RECORDS

> Complemento de `BEATSONE_CONSTITUTION_v1.md`. Cada ADR registra una decisión
> congelada, su contexto y su consecuencia. Leer ambos archivos antes de auditar o
> modificar código.

Formato: **Contexto** (por qué) · **Decisión** (qué) · **Consecuencia** (efecto).
Estado por defecto: **Aceptada / Congelada**.

---

## ADR-001 — Organismos de primer orden
**Contexto:** la arquitectura previa giraba en torno a un protagonista único y una
mezcla dominante; no existían organismos como entidades reales.
**Decisión:** Rhythm, Texture y Vox son entidades de primer orden con standing
equivalente, cada una con identidad/estado/memoria/atención/idioma.
**Consecuencia:** toda la arquitectura posterior se organiza por organismo; la
simetría Rhythm/Texture/Vox es invariante (romperla = incorrecto).

## ADR-002 — Separación organismo / cualidad / mezcla
**Contexto:** ORCH fusionaba en un solo argmax tres cosas: qué organismo lidera,
qué cualidad domina y cómo se aplica la mezcla.
**Decisión:** descomponer ORCH en tres. La parte organismo migra a T2; la cualidad
va a estadio/dramaturgia (F5); la mezcla al árbitro único (F3).
**Consecuencia:** `PROTO` desaparece con T2; `ENTITY` se vuelve distribución T2.

## ADR-003 — Attention Simplex
**Contexto:** la atención se confundía con volumen/mezcla.
**Decisión:** la atención es un símplex `{r,t,v}=1` con piso ε, fuente única
centralizada, leída read-only por capas superiores. Expresa relevancia ecológica,
no volumen. Migra como trayectoria (current→target), no por setters.
**Consecuencia:** ninguna capa puede tratar la atención como gain; el símplex
alimenta un fan-out de canales con destinos disjuntos.

## ADR-004 — Competencia vs Iniciativa (T1 ≠ T2)
**Contexto:** asignación de recursos e iniciativa de acción estaban entremezcladas.
**Decisión:** T1 (budget/nodes/voice-stealing/eviction/packet-loss) y T2
(iniciativa) son capas separadas. La iniciativa jamás asigna recursos.
**Consecuencia:** contrato de realización "T2 propone, T1 otorga": una acción
ocurre solo si gana la contienda y hay presupuesto.

## ADR-005 — Ownership total del audio
**Contexto:** tras F1, 5 generadores (sub-body, sub, FIELD, fossils, vox-preview)
conectaban directo a masterGain, fuera de todo organismo.
**Decisión:** todo nodo generador de audio pertenece a exactamente un organismo;
rerutados en v50 (sub-body/sub/FIELD→Rhythm, fossils→Texture, preview→Vox). Solo
infraestructura documentada (master chain, unlock iOS, recorder tap) toca
comp/destination.
**Consecuencia:** solo/mute y, en F2, la atención gobiernan todo el material
audible. La dramaturgia modula material pero no lo posee.

## ADR-006 — Cláusula idioma-agnóstica
**Contexto:** los únicos gestos discrecionales claros de Rhythm aparecían en IKEDA;
diseñar T2 alrededor de un idioma habría exigido excepciones por cada ADN.
**Decisión:** T2 nunca depende de un idioma. Cada organismo declara un vocabulario
discrecional abstracto; el ADN solo elige disponibilidad/propensión. Separación
intra (ADN elige acción) / inter (T2 elige organismo).
**Consecuencia:** cualquier rhythmDNA futuro se incorpora poblando vocabulario sin
tocar la arquitectura de iniciativa.

## ADR-007 — Anti-monopolio de T2 (constitucional, no configurable)
**Contexto:** un argmax o un compounding temporal recrean el protagonista único.
**Decisión:** muestreo proporcional (nunca argmax), techo+piso en la transferencia,
anti-racha obligatoria, flujo unidireccional (iniciativa nunca modifica atención).
Los perfiles pueden tocar estilo de liderazgo/rotación, jamás estos invariantes.
**Consecuencia:** ningún camino (directo o indirecto) puede reintroducir monopolio.

## ADR-008 — Fan-out con destinos disjuntos; gain último
**Contexto:** si T1–T4 leyeran el símplex con la misma curva y mismo destino,
colapsarían en "más volumen".
**Decisión:** cada canal tiene transferencia propia, resolución temporal propia y
destino downstream disjunto. Gain es consecuencia secundaria y acotada (sub-canal
de T4), nunca la representación primaria.
**Consecuencia:** los canales se pueden combinar de forma divergente (p.ej. alta
iniciativa + bajo presupuesto) sin volverse una perilla de volumen.

## ADR-009 — Topología F1 (organismGain transparente)
**Contexto:** introducir organismos sin alterar síntesis ni romper v48.
**Decisión:** insertar `organismGain` por organismo entre los panners de buses
funcionales y masterGain, en unidad (1.0). Los escritores de mezcla existentes
modulan dentro del organismo (debajo del panner), ortogonales al organismGain.
**Consecuencia:** salida idéntica a v48 hasta que algo mueva un organismGain; el
organism gain es inmune a las peleas de autoridad de ORCH (multiplicador superior).

## ADR-010 — Dramaturgia modula pero no posee material
**Contexto:** el FIELD (lecho de presión) está modulado por tension/weather; ¿es
material de organismo o sustrato dramatúrgico?
**Decisión:** todo audio persistente o emitido pertenece a un organismo, aun cuando
lo gobiernen variables dramatúrgicas. FIELD → Rhythm. La modulación por
tension/weather permanece; el ownership es del organismo.
**Consecuencia:** no hay "sustrato" fuera de los organismos; la dramaturgia influye
desde afuera.

## ADR-011 — Verificabilidad de F1 desde la UI (panel temporal)
**Contexto:** VOX SOLO/MONITOR/PRIORITY operan sobre lógica pre-F1 y no aíslan
coherentemente; `applySoloMute()` nunca se invocaba.
**Decisión:** panel temporal **F1 DEBUG** aislado (solo/mute por organismo →
`applySoloMute()` → organismGain), sin tocar los controles legacy. Solo = aislar
(otros→0), sin auto-amplificación (atención ≠ volumen).
**Consecuencia:** F1 se demuestra end-to-end. Los controles legacy se reinterpretan
después: VOX SOLO → wrapper sobre F1; VOX MONITOR → preset T4/F3; PRIORITY MODE →
selector de fuente.

## ADR-012 — Orden de migración F1–F7
**Decisión:** F1 organismos → F2 attention simplex → F3 árbitro único → F4 DESTINY
neutro → F5 estadios+conductor → F6 grafo relacional → F7 export/stems/LUFS. No
alterar salvo justificación técnica fuerte.
**Consecuencia:** el cuello de botella (topología/mezcla) se resuelve antes de
construir capas semánticas encima.

## ADR-013 — V2-P1 pendiente (estadio global vs por-organismo)
**Contexto:** el grafo relacional sugiere que el estadio por-organismo (Modelo B)
es más potente, pero la decisión condiciona F5.
**Decisión:** no resolver aún; diseñar compatible con ambas. El símplex indexado
por organismo ya es forward-compatible con Modelo B.
**Consecuencia:** bloquea parcialmente F5 y la parte estadio de T5; no bloquea F2.

## ADR-014 — Los eventos de carga no tienen autoridad sobre mezcla, foco ni atención
**Contexto:** `_autoArm` activaba `voxSolo=true` (más un flip global a
`priorityMode='sample'` que muteaba buses de otros organismos) al decodificar un
vox pack, eclipsando el Rhythm/Texture ya cargado. Disponibilidad de material y
relevancia perceptual son capas distintas; el código las acoplaba
(`material_ready → foco`).
**Decisión:** la llegada de material para un organismo (Rhythm, Texture o Vox)
solo puede modificar el estado de *disponibilidad* de dicho organismo. Un evento
de carga no puede imponer cambios de mezcla, foco, atención, solo/mute ni
protagonismo sobre otros organismos. Se prohíben las transiciones automáticas:
- `material_ready → solo`
- `material_ready → mute de terceros`
- `material_ready → protagonista`
- `material_ready → atención dominante`

La selección interna de fuente sonora (sample/synth u otras equivalentes) podrá
modificarse automáticamente **siempre que permanezca confinada al organismo
afectado** y no altere el comportamiento de otros organismos. La atención, el
foco perceptual y cualquier forma de relevancia distribuida pertenecen
exclusivamente a las capas F2/T4 o a sus sucesoras constitucionales.
**Principio:** Disponibilidad no implica relevancia. Cargar material no implica
otorgarle autoridad.
**Consecuencia:** se deroga el auto-`voxSolo` por disponibilidad. La
auto-selección de fuente sobrevive solo si es per-organismo; el `priorityMode`
global actual + `applyPriorityToBuses` (que mutea Rhythm/Texture) queda del lado
prohibido hasta volverse per-organismo. La política de atención distribuida se
realiza cuando exista F2-controlador; hasta entonces rige estado-propio.

---

## ADR-015 — Fuentes de verdad ecológicas y bridge futuro de visualización
**Contexto:** la auditoría de SBO identificó una divergencia entre estructuras
diseñadas para coexistencia multi-pack y estructuras diseñadas para un único pack
activo. `SAL.voxSlots`, `PACK_MEM.bank` y `VOXMEM` operan de forma acumulativa.
`VOXDNA.fragments` y `VOXDNA.relations` operan con reemplazo total por import. La
metadata curatorial completa permanece retenida en `PACK_MEM.bank[].pack.fragments`
incluso tras sucesivos imports; el scheduler vocal consume `VOXDNA.fragments` y
`VOXDNA.relations`. Existe `PACK_MEM.getHot()` como interfaz pública diseñada para
exponer múltiples packs activos simultáneamente, actualmente sin consumidores.
Existe `SPUK_STATE_BUS` documentado como "Future visual bridge". La pérdida
observada tras imports sucesivos no es destrucción de metadata sino pérdida de
indexación: la información continúa en `PACK_MEM` pero deja de ser visible para
ciertos consumidores.
**Decisión:** se establece la siguiente jerarquía conceptual de autoridad:
- **PACK_MEM** — fuente de verdad ecológica persistente: catálogo completo de
  packs, metadata curatorial, genealogías, relaciones, estados HOT/WARM/COLD,
  coexistencia multi-pack.
- **SAL** — fuente de verdad de reproducción: buffers, estado de decode,
  disponibilidad de audio, routing operativo.
- **VOXMEM** — fuente de verdad de memoria narrativa de sesión: historial de
  reproducción, fatiga, residuos narrativos, memoria de cadenas.
- **SPUK_STATE_BUS** — API pública de exportación ecológica (rol futuro): estado
  agregado del ecosistema, bridge hacia visualizadores externos, desacoplamiento
  de consumidores externos de la implementación interna del scheduler.
- **VOXDNA** — vista operativa del scheduler: selección, scoring, gates
  narrativos, estado operativo temporal. No debe considerarse fuente de verdad
  persistente.

Ningún consumidor externo deberá depender de `VOXDNA.fragments` ni
`VOXDNA.relations` como fuente persistente de estado ecológico. Los futuros
visualizadores, bridges, exportadores o herramientas curatoriales deberán
consumir desde `PACK_MEM`, `VOXMEM` o `SPUK_STATE_BUS`.
**Consecuencia:** este ADR no modifica comportamiento ni autoriza cambios de
código. Fija autoridad conceptual para evitar futuras decisiones incompatibles
con la evolución multi-pack del ecosistema. Cualquier futura evolución del
scheduler, del sistema de packs o del visualizador deberá preservar la separación
entre almacenamiento ecológico (`PACK_MEM`), reproducción (`SAL`), memoria
narrativa (`VOXMEM`), exportación de estado (`SPUK_STATE_BUS`) y selección
operativa (`VOXDNA`), aunque internamente compartan datos o estructuras.

---

## ADR-016 — Session Presets: INSTALLATION, PERFORMANCE, FREE (reservado)
**Contexto:** SBO valida ahora scheduler multi-pack (ADR-015), PACK_MEM como
autoridad ecológica, DESTINY hasta TERMINAL, Graceful Death y REBIRTH (existente,
deshabilitado por default, sin wiring). Tres sistemas — `PROFILES` (parámetros
temporales SHORT/IMMERSION/DEEP/INST), `SYS.perfMode` (LIVE/INSTALLATION/HYBRID,
gobierna autonomía y macro weights) y `REBIRTH.enabled` (ciclo muerte/renacimiento)
— existen de forma independiente, sin selector unificado, exactamente la
dispersión que la Constitution ya marcó como corrección pendiente ("Autonomía
dispersa en 4 lugares... → consolidar"; "RITUAL PROFILE renombrado → SESSION
PRESET").

**Decisión:** SESSION PRESET es la capa conceptual que **agrupa** configuraciones
de sistemas existentes — nunca una autoridad nueva, nunca un sistema paralelo.
Selecciona valores iniciales de `PROFILES`/`perfMode`/`REBIRTH.enabled`; el
operador puede modificarlos individualmente después sin restricción.

Tres presets:

**INSTALLATION** — `PROFILES.INST` + `perfMode='INSTALLATION'` +
`REBIRTH.enabled=true` + política REBIRTH HÍBRIDO (ver abajo). DESTINY activo,
opera sin intervención humana.

**PERFORMANCE** — `PROFILES` a elección del operador + `perfMode='LIVE'` +
`REBIRTH.enabled=false`. DESTINY activo; al llegar a TERMINAL, Graceful Death es
definitiva — el silencio final es parte de la obra. El operador decide cuándo
reiniciar.

**FREE** — *reservado, no implementar*. Documentado únicamente como intención
conceptual: un futuro modo donde DESTINY no impone cierre narrativo. Su mecanismo
(p.ej. un flag de neutralidad de DESTINY) queda **fuera de alcance** de este ADR y
requiere su propio ADR cuando se aborde — probablemente cruzándose con la futura
F4 (DESTINY neutro).

**Política REBIRTH HÍBRIDO:** en cada transición de renacimiento
(`REBIRTH._emerge()`):

*Resetear* — estado transitorio de `_s` (vocFatigue, clarityDebt,
coherenceDesire, voiceMemory, lastNarrativeTime, lastGhostTime,
forcedSilenceUntil, forcedFragUntil, bioCollapsing, orchRecovering — "locks
temporales" que gobiernan *cuándo* puede emerger algo); `VOXMEM.recent`;
`VOXMEM._played` (chain-locks); `VOXMEM.attentionFatigue`. DESTINY se reinicia
vía `DESTINY.init()` (ya ocurre hoy). `attentionFatigue` se clasifica junto a
`vocFatigue` como mecanismo transitorio de regulación de emergencia — ninguna de
las dos variables constituye memoria narrativa ni contaminación ecológica
persistente; conservarla haría nacer cada vida nueva parcialmente fatigada por la
vida anterior.

*Conservar* — `VOXMEM.residue` (narrative/ghost/subconscious — la "huella
ecológica" de tendencias de largo arco); `REBIRTH.inherited` (contaminación SMEM,
weatherBias, crystal, traumaShadow — ya implementado, sin cambios). `PACK_MEM` no
participa de este reset — el catálogo de packs es independiente de los ciclos de
vida (confirma ADR-015).

**Tres escalas temporales declaradas:**
- *Nueva sesión* (PLAY tras STOP) → reset completo (`VOXDNA.reset()` existente,
  incluye `residue`). La obra nace desde cero.
- *Nueva vida* (REBIRTH) → reset parcial (`VOXDNA.rebirthReset()`, nuevo). La obra
  recuerda tendencias/clima/contaminación; olvida bloqueos, cansancio y cadenas
  recorridas.
- *Continuidad ecológica* → `residue`, `weatherBias`, `crystal`, `traumaShadow`,
  `PACK_MEM` persisten a través de vidas. El ecosistema continúa aunque una vida
  termine.

**Mecanismo nuevo requerido:** `VOXDNA.rebirthReset()` — **distinto** del reset
completo existente (`VOXDNA.reset()`, invocado en `_doStartPlay()`, que limpia
*todo* incluyendo `residue`). Los dos resets tienen semánticas distintas y no
deben confundirse ni unificarse: reset completo = evento de sesión
(operador-iniciado); reset parcial = evento de vida (autónomo, dentro de la misma
sesión).

**Consecuencia:** PERFORMANCE requiere cero código nuevo — es el default actual
(`REBIRTH.enabled=false`), nombrado. INSTALLATION requiere: (1)
`VOXDNA.rebirthReset()`, (2) wiring de los tres sistemas existentes bajo un
selector de preset, (3) verificación en dispositivo de al menos un ciclo completo
(muerte → residual → renacimiento → nueva vida) antes de production-ready, dado
que la combinación PROFILES.INST + perfMode=INSTALLATION + REBIRTH nunca fue
probada junta. FREE queda como nombre reservado sin implementación ni primitivas
nuevas — ninguna implementación futura debe tocar `DESTINY` bajo el nombre FREE
sin su propio ADR.

### ADR-016 — Enmienda 01

**Contexto:** durante la auditoría previa a la Fase B se verificó que
`TEMPORAL.computeParams(durationMin)` sobrescribe en cada PLAY los parámetros
temporales efectivos (`phaseMult`, `collapseMult`, `silCycles`, `maxEvPerBar`,
`memDecay`, `satDecay` y `driftMult`) a partir de `TEMPORAL.plannedDuration`. Como
consecuencia, `PROFILES.INST` no constituye una autoridad persistente sobre el
comportamiento temporal de la sesión y no debe ser considerado el mecanismo
principal del preset INSTALLATION.

**Corrección:** reemplazar en la definición del preset INSTALLATION
"`PROFILES.INST` + `perfMode='INSTALLATION'` + `REBIRTH.enabled=true`" por
"`TEMPORAL.plannedDuration` (larga duración, valor a definir por implementación) +
`perfMode='INSTALLATION'` + `REBIRTH.enabled=true`".

**Aclaración:** `PROFILES` puede seguir utilizándose como capa de interfaz o
clasificación conceptual, pero la dinámica temporal efectiva de INSTALLATION queda
determinada por `TEMPORAL.plannedDuration` y los parámetros derivados por
`TEMPORAL.computeParams()`. No se modifica ninguna otra sección de ADR-016: la
política REBIRTH HÍBRIDO, la definición de `rebirthReset()`, la persistencia de
PACK_MEM y la reserva explícita de FREE permanecen sin cambios.

### ADR-016 — Enmienda 02

**Contexto:** la validación empírica de Fase B (v61) mostró que con
`REBIRTH.enabled=true` + `perfMode='INSTALLATION'`, el ciclo TERMINAL → Graceful
Death → REBIRTH no se activa. `_gracefulDeath()` — único disparador de
`onDeath()`/`_emerge()`/`rebirthReset()` — está condicionado por
`phase01>=1 && GOVERNANCE.autonomy>.5 && isPlaying` (L1947). `GOVERNANCE.autonomy`
(default `.3`) es independiente de `perfMode`/`autoAutonomyCap`/`REBIRTH.enabled`
y no formaba parte del bundle SESSION PRESET. Existía por tanto una dependencia no
documentada entre DESTINY, REBIRTH y CONSCIOUSNESS/autonomy que invalidaba el
comportamiento esperado del preset INSTALLATION.

**Corrección:** el preset INSTALLATION setea adicionalmente
`GOVERNANCE.autonomy=1`; el preset PERFORMANCE setea adicionalmente
`GOVERNANCE.autonomy=.3` (valor original por defecto). Definiciones resultantes:
- **INSTALLATION** = `TEMPORAL.plannedDuration` (larga) + `perfMode='INSTALLATION'`
  + `REBIRTH.enabled=true` + `GOVERNANCE.autonomy=1`.
- **PERFORMANCE** = `perfMode='LIVE'` + `REBIRTH.enabled=false` +
  `GOVERNANCE.autonomy=.3`.

Esto es coherente con el significado operativo de ambos modos: en PERFORMANCE el
operador conduce (autonomía baja); en INSTALLATION el sistema conduce (autonomía
alta).

**Aclaración:** INSTALLATION requiere autonomía suficiente para permitir la
transición TERMINAL → Graceful Death → REBIRTH. Actualmente esto equivale a
`GOVERNANCE.autonomy>.5`, pero el ADR no depende del valor numérico concreto sino
de la capacidad del sistema para completar autónomamente su ciclo de vida; si el
umbral cambiara en el futuro, `GOVERNANCE.autonomy=1` seguiría satisfaciéndolo por
construcción. No se modifica ninguna otra sección de ADR-016 ni de su Enmienda 01.

---

## ADR-017 — Reorganización de UI por intención operativa (PERFORMANCE / DNA CENTER / MATERIAL / SYSTEM)

**Contexto:** la auditoría de superficies LIVE (ver hallazgos previos a este ADR)
encontró 15+ controles ya implementados y funcionales — sliders ENERGY/TENS/
DENS/MUT, IMM, MASS, 5 perfiles de identidad (ORG/SIG/MASS/GEO/SIL vía
`BEHAVIORAL_PROFILES.setProfile()`), botones de WEATHER, AUTO+phase-adv (`PE`),
8 pads de gesto (`injectGesture`), CONSCIOUSNESS (autonomy), SESSION PRESET
(ADR-016), CONDUCTOR (FOCUS/ENTITY/VOX) — pero distribuidos entre `header`,
`LAB`, `EXPORT`, `RHYTHM DNA`, `SOUND DNA` y `VOX DNA` según la **historia interna
del desarrollo**, no según el flujo mental del operador. Esto hace que capacidades
ya construidas (en particular MASS, los 5 perfiles de identidad, WEATHER manual y
PHASE ADV) nunca hayan sido probadas en conjunto, porque viven en tres lugares
distintos.

**Decisión:** reorganizar la UI en 4 tabs por intención operativa, reemplazando
las 6 actuales (RHYTHM DNA / SOUND DNA / VOX DNA / PERFORMANCE / EXPORT / LAB):

### PERFORMANCE — todo lo que se toca durante una sesión

| Subgrupo | Controles | Ubicación actual |
|---|---|---|
| STAGE | AUTO (`#tgl-auto`), PHASE ADV (`#phase-adv`) | PERFORMANCE/PHASES |
| STAGE | botones WEATHER (`.wbtn`) | EXPORT |
| STAGE | SESSION PRESET (INSTALLATION/PERFORMANCE) | LAB |
| STAGE | DURATION | RHYTHM DNA |
| ENERGY | sliders ENERGY/TENS/DENS/MUT | LAB/GLOBAL STATE |
| ENERGY | IMM (`#imm-btn`) | header |
| ENERGY | MASS slider (`#mass-slider`, `RHYTHM_DNA.mass`) | RHYTHM DNA |
| ENERGY | CONSCIOUSNESS (autonomy) | LAB |
| INTERVENTION | 8 pads BREAK/FILL/VOID/GHOST/MORPH/CHAOS/MUTE/CONCLUDE (`#bot_h`) | flotante, sin tab |
| INTERVENTION | VOX MONITOR (`#vox-mon-btn`), REC | header |
| CONDUCTOR | FOCUS/ENTITY/VOX (`#cond-*`) | PERFORMANCE/CONDUCTOR (sin cambio) |

### DNA CENTER — todo lo que define la identidad del sistema

| Subgrupo | Controles | Ubicación actual |
|---|---|---|
| IDENTITY | 5 perfiles ORG/SIG/MASS/GEO/SIL (`.bp-btn` → `BEHAVIORAL_PROFILES.setProfile()`), consolidar la versión de header (7px) y la de RHYTHM DNA/ENGINE PRESETS en una sola | header + RHYTHM DNA |
| IDENTITY | RITUAL PROFILE | EXPORT |
| IDENTITY | DNA IDENTITY / ANCHOR (`PACKS[]`/`DNA.setAnchor`) | SOUND DNA |
| RHYTHM | RHYTHM DNA CODE editor | RHYTHM DNA |
| RHYTHM | TEMPO CURVE | RHYTHM DNA |
| VOX | ENTITY ENGINE, VOICE ECOLOGY, VOX PRESENCE, PRIORITY MODE | VOX DNA |

### MATERIAL — todo lo que es contenido

| Controles | Ubicación actual |
|---|---|
| PACK BANK, SAMPLES | SOUND DNA |
| PACK BRIDGE (ADR-015) | LAB |
| `audio-mode-ind` "HYBRID" (prioridad sample/synth) | header |
| MIC | header |

### SYSTEM — todo lo técnico

| Controles | Ubicación actual |
|---|---|
| SESSION LOG | LAB |
| SESSION EXPORT, STATE BUS | EXPORT |
| SPATIAL, SIM MULT | LAB |
| DBG / DBG▶ / `sys-ready-ind` | header |

### Header (se mantiene, reducido)

BPM (`-`/`+`/TAP), PLAY/STOP, LIVE MODE, indicadores compactos siempre visibles
(`#ob-proto`, `#ob-tension`+bar, `#ob-arc`, `#ob-vox`, `#ob-sub`, `#dna-badge`,
DBG compacto). Los 5 botones de identidad y el slider MASS se retiran del header
y de RHYTHM DNA respectivamente, consolidados en DNA CENTER/PERFORMANCE.

**Restricción (mover, no rediseñar):** cada control conserva su `id`, su event
listener y la autoridad/sistema que ya lee o escribe (`G.*`, `PE.*`,
`BEHAVIORAL_PROFILES`, `RHYTHM_DNA`, `WEATHER`, `GOVERNANCE.autonomy`, `REBIRTH`,
`PACK_MEM`, etc.). Esta reorganización es exclusivamente de contenedores HTML/CSS
(qué `<div class="ws-panel" id="tab-X">` envuelve a cada elemento) y de la barra
de tabs (`#ws-tab-bar`, 6 botones → 4). No se modifica `PE`, `VOXDNA`, `DESTINY`,
`REBIRTH`, `BEHAVIORAL_PROFILES`, `PACK_MEM`, ni ningún ADR previo (014/015/016).

**Consecuencia:** riesgo bajo, reversible (es HTML/CSS). Habilita la primera
prueba conjunta de MASS + DENS/TENS + PHASE ADV + perfiles de identidad — todos
accesibles desde una sola tab por primera vez. Antes de implementar, verificar:
(1) que ningún listener dependa de un selector acotado al contenedor de tab
actual (p.ej. `#tab-lab .sl-wrap` en vez de `.sl-wrap` global) — el patrón
observado hasta ahora es `document.querySelectorAll` global, sin acotar; (2) que
no existan IDs duplicados entre las variantes `_h` (landscape) y no-`_h` de un
mismo control al consolidarlos; (3) que `init*()` functions (llamadas una vez en
boot) no asuman visibilidad/`display` del contenedor original.

---

## ADR-018 — Pipeline de import de voces: 7 fixes consolidados (v65–v73)

**Contexto:** auditoría forense de extremo a extremo del pipeline de import de
packs, disparada por "ALL BOUND 13/13 pero solo se escucha ruido". Detalle
completo, causa raíz por causa raíz, en `docs/SBO_FIX_LOG_v65-v73.md`.

**Decisión:** quedan **fijados como comportamiento correcto** (no revertir sin
releer el fix log primero):
1. `VOX_ARC.phaseWeight()` bypassea a `.7` para `command`/`ritual` cuando
   `SAL.voxReady>0`, espejando el bypass ya existente en `allows()`.
2. `VOXMEM.score()` otorga el bonus `wAffinities` (+0.28) a `command`/`ritual`
   bajo la misma condición — esas dos categorías nunca aparecen en las listas
   de afinidad climática por nombre, así que sin este bypass nunca son
   competitivas frente al clúster `ghost`.
3. `_decodeDataURL()` decodifica base64 manualmente (`atob`+`Uint8Array`) en
   vez de `fetch(dataURL)` — `fetch()` sobre URLs `data:` puede devolver los
   bytes ASCII crudos del string en vez del binario, produciendo audio
   "decodificado con éxito" pero compuesto de ruido. Esta es la causa raíz
   central de todo el síntoma original.
4. `VOXTRACE` ahora también registra los fallbacks legacy
   (`_legacyNarrativeFire`/`_legacyGhostFire`) — un `REJECTED` de `fire()` no
   implica silencio, porque esos fallbacks no repiten ninguno de sus gates.
5. Tab nueva **DNA CENTER (AUDIT MODE)** — diagnóstico puro (pack/entity
   inspector, audición directa bypass-total, analizador de buffer real,
   monitor de actividad, solo/mute/gain auditable para RHYTHM/VOX/TEXTURE).
   No toca scheduler/scoring/decode/parsing.

**⚠️ Conflicto con ADR-017:** ADR-017 ya reserva el nombre "DNA CENTER" para
la tab de **identidad** (perfiles, RITUAL PROFILE, ANCHOR). La tab de
diagnóstico de este ADR usa el mismo nombre para un propósito no relacionado.
Pendiente de resolver antes de implementar ADR-017 — alguna de las dos
necesita renombrarse.

**Pendiente, no resuelto en esta tanda:** P1 (`weatherAffinity`/
`preferredPhase` del manifest siguen sin leerse en ningún punto de
scoring/scheduling — metadata muerta); causa del contenido ruidoso de
`semantic_ghost_a/b` trasladada a investigación en Sound Forge
(`sound-forge-p33.html`, `_renderSemanticGhost`), aún sin confirmar si ese
código corre en el pipeline real de Bank Export o es legado inactivo.

---

## Regla práctica de sesión
Antes de cualquier auditoría o cambio de código, cargar en este orden:
`BEATSONE_CONSTITUTION_v1.md` → `ARCHITECTURE_DECISIONS.md`. Recién después auditar.
