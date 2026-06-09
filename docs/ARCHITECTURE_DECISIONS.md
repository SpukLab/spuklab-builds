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

---

## Regla práctica de sesión
Antes de cualquier auditoría o cambio de código, cargar en este orden:
`BEATSONE_CONSTITUTION_v1.md` → `ARCHITECTURE_DECISIONS.md`. Recién después auditar.
