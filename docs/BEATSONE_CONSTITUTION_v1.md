# BEATSONE_CONSTITUTION_v1

**Especificación técnica canónica — Gramática Ritual v1**
**Proyecto:** SpukBeatsOne (SBO) — instrumento ritual generativo single-file HTML / Web Audio (iPad Safari landscape, GitHub Pages)

| Campo | Valor |
|---|---|
| **Status** | **Ratified** |
| **Version** | **1.0** |
| **Build de referencia** | v49 (F1 implementado) |
| **Autoridad** | Fuente única de verdad. Por encima de la memoria de cualquier modelo. |

> **Uso obligatorio.** Toda sesión nueva de Claude, ChatGPT o Gemini debe leer este archivo **antes** de analizar o modificar código y tratarlo como fuente de verdad. No resumir, no reinterpretar, no simplificar. La terminología aquí es la utilizada durante las auditorías y es vinculante.

---

## 1. GRAMÁTICA GENERAL

La **Gramática Ritual v1** está **congelada**. No se re-discute: organismos, dramaturgia, relaciones, atención como símplex, fan-out, F1. Todo eso está ratificado.

**Organismos:** Rhythm, Vox, Texture.

**Ejes del momento ritual:** Estadio, Registro, Densidad, Atención, Autonomía.

**Dramaturgia:** Ritual Entrópico.

**Modos:** Pátina, Sedimentación, Desgaste.

**Destino:** Rebirth, Extinción.

**Relaciones:** Influencia dirigida. Tipos: Excitar, Suprimir, Contaminar, Diferenciar.

**Competencia:** Separada explícitamente de Relaciones.

**Glosario de fases (F) y canales (T):**
- **F (Fases):** etapas de migración arquitectónica (F1 → F7).
- **T (Canales / tiers):** canales del fan-out de atención + autoridad relacional — T1 Competencia, T2 Iniciativa, T3 Persistencia, T4 Foco perceptual, T5 Relaciones.

**Mapa fase ↔ alcance:**
- **F1** — capa de organismos (`organismGain`). **Implementado (v49).**
- **F2** — símplex de atención + fan-out a T1/T2/T3/T4 + trim de gain acotado sobre `organismGain`. **Especificado (ratificado).**
- **F3** — reconciliación de mezcla (migración de `applyLeadership`/`applyBusGains` de ORCH).
- **F4** — dramaturgia / destino (DESTINY neutro en F4).
- **F5** — reconciliación de la parte-cualidad de ORCH con el eje Estadio.
- **F6** — T5 (autoridad relacional / grafo).
- **F7** — cierre del plan de migración.

---

## 2. PRINCIPIOS CONSTITUCIONALES

**P1 — Organismos de primer orden simétricos.** Tres organismos, y solo tres (Rhythm, Vox, Texture), como entidades de primer orden simétricas. Ningún organismo privilegiado por construcción.

**P2 — Atención ≠ Volumen.** La atención nunca se representa primariamente como gain. Controla decisiones, iniciativa, memoria, competencia por recursos y foco perceptual. La mezcla solo traduce **parcialmente** la atención. **El gain es el último canal y el menos importante.**

**P3 — Prohibición de Winner-Takes-All.** No puede existir un ganador absoluto. Un organismo con 0.70 de atención inicia más, pero los demás siguen pudiendo iniciar. El WTA (argmax, `sort()[0]`, "un protagonista domina") está prohibido como mecanismo de protagonismo de organismo.

**P4 — Atención como Fan-out.** La atención no es una traducción única; es un fan-out: una fuente (el símplex) alimenta varios canales, cada uno con transferencia propia y destino downstream disjunto.

**P5 — Separación Atención / Mezcla.** La capa de decisión (iniciativa, memoria, competencia, foco) y la capa de mezcla (gains/buses) son distintas y de destinos disjuntos. El gain es consecuencia última y acotada, nunca el canal primario.

**P6 — Competencia ≠ Relaciones.** La Competencia (recursos finitos) está separada explícitamente de las Relaciones (influencia dirigida). El destino de la competencia (presupuesto) se mantiene estrictamente disjunto del destino relacional.

**P7 — Disciplina de trabajo.** No código hasta auditoría completa / esperar aprobación. Toda fase atraviesa diseño conceptual → auditoría → aprobación explícita → implementación. Comunicación de proyecto en español.

---

## 3. ORGANISMOS DE PRIMER ORDEN

Existen tres organismos de primer orden **simétricos**: **Rhythm**, **Vox**, **Texture**.

La asimetría histórica de la UI (Vox con panel entero, Texture casi invisible, Rhythm como "DNA code") es una **violación** a corregir, no la arquitectura. Los tres deben tener la misma estructura: identidad+estado, ADN/idioma, material asignado, solo/mute simétrico (F1) y vocabulario de acciones discrecionales (T2, futuro).

Material por organismo: Rhythm ← kick/snare/hat/bass; Texture ← texture; Vox ← fragmentos.

---

## 4. SEPARACIÓN ORGANISMO / CUALIDAD / DRAMATURGIA

Tres planos distintos que el código y la UI deben mantener separados:

- **Organismo (entidad):** Rhythm / Vox / Texture. Distinto de su **ADN** (color) y de su **idioma seleccionado**.
- **Cualidad / estado:** pressure / fragmentation / ghost / silence / trance / erosion + emoción/intención/deseo dominantes (META/EMO/INTENTION). Es el dominio donde un winner-takes-all es **legítimo** (una emoción dominante está bien).
- **Dramaturgia / estadio:** Ritual Entrópico, modos, destino, movimientos/moradas — la agenda dramática global o por-organismo.

El "protagonista" de ORCH **fusiona** indebidamente tres cosas: qué cualidad lidera (cualidad), qué organismo lidera (organismo), y la aplicación de mezcla. La constitución exige des-fusionar: la parte-organismo → T2; la mezcla → F3; la cualidad/estadio → F5. Confundir organismo con su ADN/idioma (p. ej. "RHYTHM DNA"/"VOX DNA") es una violación explícita.

---

## 5. F1 — ORGANISMOS

**Estado: IMPLEMENTADO en v49.**

**Definición:** Los organismos (Rhythm, Vox, Texture) congelados como entidades de primer orden. Cada uno posee un sub-bus propio (`organismGain`). Los buses funcionales viven **dentro** de organismos.

**Implementación realizada (v49):**
- Tres organism sub-bus gains **transparentes** (default **1.0**) insertados entre los buses funcionales y `masterGain`, dentro de `BUS.init`.
- `nodeCount` de **21 a 24**.
- **solo / mute** cableado sobre los organism gains (`window.ORGANISM.<organismo>.solo` / mute).

**Invariantes:**
- `organismGain` transparente (1.0): F1 no cambia el sonido, solo crea la topología de organismo.
- Solo/mute simétrico para los tres.
- F1 es **prerequisito duro** de F2.

---

## 6. F2 — ATTENTION SIMPLEX

**Estado: ESPECIFICADO (ratificado). No implementado.**

### 6.1 El símplex

`attentionSimplex.current` = `{ rhythm, vox, texture }`, **suma = 1.0** (normalizado). Componentes (fuente única, centralizada):
- **current** — estado vivo de runtime (computado).
- **target** — hacia dónde se mueve la atención.
- **floor (ε)** — mínimo por organismo (presencia perceptual mínima). Probablemente constante del sistema.

El símplex está **indexado por organismo** (3 valores) → forward-compatible con el Modelo B (estadio por-organismo, V2-P1).

### 6.2 Migración como trayectoria gobernada

Unifica tres comportamientos como **formas de la trayectoria del target** (no mecanismos aparte):
- **Migración** — el target se desplaza; current lo persigue.
- **Congelado** — target = current (o rate = 0); sostenido → **Meseta** (restricción 4).
- **Oscilación** — el target alterna entre dos puntos del símplex con un período; current lo sigue → **Péndulo** (restricción 5).

Un **límite de velocidad angular** sobre el símplex garantiza que incluso un cambio brusco de target produzca un movimiento **suave** del current.

### 6.3 Fan-out a los canales

Regla: **mismo `current`, transferencia propia, destino disjunto.** Cada canal consume el símplex a su propia resolución temporal.

| Canal | Transferencia (lectura del símplex) | Destino downstream | Resolución | Semántica |
|---|---|---|---|---|
| **T1 Competencia** | porción de atención → porción del presupuesto finito | asignador de presupuesto (capa de competencia) | por compás | sesga la competencia; separado del grafo |
| **T2 Iniciativa** | atención → peso en la probabilidad de emerger/iniciar (curva más empinada que lineal, acotada) | capa de decisión/scoring | por decisión (rápido) | **canal primario** — "quién actúa" |
| **T3 Persistencia** | atención → tasa inversa de decaimiento + frecuencia de recurrencia | dinámica de memoria por organismo | integrado lento | canal inercial — "qué recuerda el ritual" |
| **T4 Foco perceptual** | atención → centrado/profundidad espacial + claridad acotada | capa espacial/panner | suavizado | traducción perceptual; el trim de gain es el sub-canal último y topeado |

**No-mezcla, en tres garantías:** (1) input compartido, transferencias distintas; (2) destinos disjuntos — ningún par de canales escribe el mismo parámetro; (3) cada transferencia es propiedad de su canal. **No-WTA (restricción 2)** se hace cumplir en el **piso ε** y las **curvas de transferencia acotadas**.

### 6.4 Parámetros

**Núcleo del símplex (cómo current sigue al target):** `inertia / migrationRate` (suavidad y tendencia a congelar); `floor (ε)` (mínimo por organismo, probablemente constante).

**Forma del target (vive en conductor/perfil):** `volatility` (con qué frecuencia cambia el target — inquieto vs comprometido; distinto de inertia); `focusSpread` (concentrada vs distribuida — "Vox-dominante" spread bajo / "ensemble" spread alto); `oscillation (período, polos)` (solo forma péndulo; pertenece al generador de trayectoria).

### 6.5 Exposición a perfiles / interno

**Expuesto (intención):** target base, focusSpread, volatility, arquetipo de trayectoria permitido (migra / congela=Meseta / oscila=Péndulo), opcional énfasis por canal.
**Interno:** `current` vivo, normalización y piso ε, mecánica de migración (viaje + límite de velocidad), funciones de transferencia y filtros temporales, mapeo atención→presupuesto/decisión/memoria/espacio, **cap del trim de gain de T4** (topeado, nunca expuesto).
**Regla:** el perfil expresa *intención*; el motor posee *mecanismo*.

### 6.6 Alcance

F2 cierra: símplex de atención por organismo + fan-out a los canales de decisión existentes + trim de gain acotado sobre el `organismGain` de F1. F2 **difiere**: autoridad relacional (T5 → F6) y autoridad de estadio (T5 → V2-P1 / F5).

---

## 7. T1 — COMPETENCIA

**Estado: especificado como canal del fan-out (F2). Implementación posterior.**

**Definición:** Asignación de **recursos finitos**: presupuesto, node count, voice stealing, memoria limitada, eviction, quotas. Pregunta diagnóstica: *"¿Hay escasez de recurso?"*

**Transferencia y destino:** porción de atención → porción del presupuesto finito; destino: asignador de presupuesto; resolución: por compás. Reparte recurso de forma **más proporcional** que la contienda compresiva de T2.

**Separaciones constitucionales:** Competencia ≠ Relaciones (P6); el destino de T1 (presupuesto) disjunto del futuro destino relacional de T5. En código actual, "afford" puede mapearse transitoriamente al `BUDGET` existente.

**Contrato de realización con T2:** **"T2 propone, T1 afford"** — una acción se realiza solo si es ganada-por-iniciativa **y** costeada-por-presupuesto. Alta iniciativa + bajo presupuesto = propone pero no ejecuta (tensión genuina, no colapso).

**Puntos de decisión que pertenecen a T1 (no migran a T2):** SAL LRU (robo de voz) — L2951; PACK_MEM evict (desalojo) — L3988.

---

## 8. T2 — INICIATIVA

**Estado: ESPECIFICADO Y AUDITADO en profundidad (ratificado). Canal primario. No implementado.**

### 8.1 Pregunta que responde

*¿Cómo influye la atención en la capacidad de un organismo para **iniciar** acciones?* No audio, no mezcla, no panners, no gains. **Solo iniciativa.** T2 es el canal más importante del sistema.

### 8.2 Hallazgo central

**La contienda de iniciativa entre tres organismos NO existe hoy.** Hoy: Rhythm/Texture emiten **clockeado** (cero iniciativa discrecional); **Vox** es el único con iniciativa real (`VOXDNA.tick`, `shouldEmerge` ~L1019/1031); **ORCH** es un WTA sobre **cualidades** (L2059-2060) que conduce la mezcla. Conclusión: el WTA del sistema vive en la **mezcla (ORCH)**, no en la iniciativa. **T2 crea una capa de contienda que no existe** y des-fusiona la confusión organismo/cualidad de ORCH.

### 8.3 Restricciones (R1–R4)

1. **R1 — No ganador absoluto.**
2. **R2 — Techo.** La atención no puede volverse `probabilidad directa = atención`. Transferencias acotadas.
3. **R3 — Spread perceptible.** Diferencia perceptible entre `0.40/0.35/0.25` y `0.80/0.10/0.10`, sin monopolio.
4. **R4 — Piso.** Un organismo en floor *raramente, pero realmente*, gana.

### 8.4 Forma de la transferencia: Softmax limitada (concentración temperada)

Candidatos: lineal/identidad (rechazada: domina arriba, muere abajo); logarítmica (dirección correcta pero puede sobre-aplanar y borrar R3); saturada/techo (buen techo, no levanta piso); **softmax limitada** (la más fuerte: opera conjuntamente, nunca 0 ni 1, preserva orden, temperatura ≡ `focusSpread`).

**Ratificado:** **redistribución conjunta compresiva con concentración temperada**, acotada entre **piso** y **techo** explícitos por organismo. La concentración jamás llega ni a uniforme ni a winner-take-all. Satisface R1–R4 simultáneamente.

### 8.5 Definición operativa

**Iniciativa = standing en contiendas**, derivado de atención por transferencia conjunta acotada (piso+techo), consumido por **muestreo proporcional, jamás argmax**, con **anti-racha** y **flujo unidireccional** como garantías. El 0.30 gana ~30% de las contiendas.

### 8.6 Convivencia con ORCH

`ORCH.resolveProtagonist` elige un protagonista (pressure/fragmentation/ghost/silence/trance/erosion + `'narrative'`), WTA con blend 2-4 bars; `applyLeadership`/`applyBusGains` lo aplican a la mezcla. Fusiona cualidad + organismo + mezcla. T2 desenreda **solo la parte de organismo**: reemplaza el WTA de protagonismo de organismo por distribución graduada; **absorbe** el scoring/sesgo de ORCH (IKEDA/behavioral/DESTINY) como *input* de la contienda; **conserva fuera de alcance** la mezcla (F3) y la cualidad/estado (F5). Coexistencia transitoria: ORCH conduce mezcla hasta F3; el `'narrative'`(=vox) queda **informado por** T2.

### 8.7 Distinción de T1 y T3 (no-colapso)

Distintos por: **curvas** (T2 compresiva, T1 más proporcional, T3 integrada/inercial); **resoluciones temporales** (T2 per-decisión, T1 per-compás, T3 integrado lento, nunca en lockstep); **semánticas** (T2 = deseo/standing; T1 = afford; T3 = memoria); **contratos** ("T2 propone/T1 afford"; "T3 recurre sin contienda nueva"). **Litmus:** deben existir estados con sentido donde divergen.

### 8.8 Exposición a perfiles / interno

**Expuesto:** target + focusSpread (de F2); **fuerza anti-racha** como carácter (alta = liderazgo rotativo; baja = sostenido — una Meseta quiere anti-racha baja).
**Interno (constitucional):** forma de la transferencia y bordes (piso/techo); muestreo proporcional + prohibición de argmax; mecánica anti-racha; contratos con T1/T3; mapeo iniciativa→puntos de decisión.
**Regla:** un perfil puede sesgar quién tiende a liderar y cuán rotativo se siente, pero **nunca** acceder a los invariantes anti-monopolio.

### 8.9 Contrato de implementación

- **T2 posee:** mecanismo de contienda, derivación de probabilidad-de-victoria desde el símplex (transferencia acotada piso+techo), memoria anti-racha, garantía de muestreo proporcional.
- **T2 NO posee:** los puntos de decisión (lo *consultan*), el sustrato clockeado, la mezcla (F3), ni la atención (read-only).
- **Flujo:** punto de decisión pregunta a T2 "¿quién gana?" → T2 devuelve un organismo **muestreado** (jamás argmax) → el punto verifica **afford (T1/BUDGET)** antes de realizar. Iniciativa jamás escribe la atención (unidireccional).

### 8.10 Migran / no migran a T2

**Migran:** emergencia discrecional de Vox (`VOXDNA.tick`/`shouldEmerge`); parte-organismo del protagonista de ORCH (`'narrative'`=vox, ~L2046, des-argmaxeada); iniciativa discrecional **nueva** para Rhythm/Texture (gestos/acentos sobre grid intacto).
**No migran:** sustrato clockeado; dominancia de cualidad/deseo/emoción (META L1512, EMO L2432, INTENTION L2412, candidatos-cualidad de ORCH → F4/F5, WTA legítimos); selección de recurso (SAL LRU L2951, PACK_MEM evict L3988 → T1); grant de foco de MIX_INTEL (L4441) + buses de ORCH → mezcla (F3/T4); recurrencia de VOXMEM/chain → T3.

---

## 9. T3 — PERSISTENCIA

**Estado: especificado como canal del fan-out (F2). Implementación posterior.**

**Definición:** memoria, recurrencia, fósiles, recapitulación, decay, retention. Pregunta: *"¿Esto decide qué sigue vivo en el tiempo?"*

**Transferencia y destino:** atención → tasa **inversa** de decaimiento + frecuencia de recurrencia; destino: dinámica de memoria por organismo; resolución: integrado lento. Canal **inercial**.

**Contrato de realización:** **"T3 recurre sin contienda nueva"** — la recurrencia de memoria es presencia-en-el-tiempo que **no** pasa por la contienda de T2; no se doble-cuenta.

**Tiers:** HOT / WARM / COLD (hoy en SOUND; en UI v2 migran a B-Persistencia).

---

## 10. T4 — FOCO PERCEPTUAL

**Estado: especificado como canal del fan-out (F2). Implementación posterior.**

**Definición:** traducción **perceptual** de la atención: centrado / profundidad espacial + claridad **acotada**; destino: capa espacial/panner; resolución: suavizado.

**Gain como sub-canal último y topeado:** el trim de gain es el sub-canal último de T4, **topeado** (cap interno, nunca expuesto). Única traducción de atención a volumen, parcial y acotada (coherente con P2).

**WTA en mezcla/foco:** el grant de foco de MIX_INTEL (`_queue.sort(weight)`, L4441) es un WTA en T4/F3 — **no es T2**; se reconcilia en F3/T4.

**VOX PRESENCE:** se **retira** de su ubicación actual y se reconceptualiza como **foco** dentro de T4 (deja de ser atención-como-volumen).

---

## 11. COSTURA PARA T5 — RELACIONES

**Estado: RESERVADO (F6). Costura prevista en F2, sin implementar.**

**Definición:** Relaciones = **influencia dirigida** entre organismos. Tipos: Excitar, Suprimir, Contaminar, Diferenciar. Competencia separada explícitamente de Relaciones (P6).

**T5 como quinto canal:** lee el mismo símplex por su propia transferencia (atención → magnitud de las **aristas salientes** del organismo) y escribe a su destino disjunto (el **grafo relacional**).

**Costura dejada por F2 (sin construir nada):**
1. Publicar `current` como lectura limpia y estable.
2. Declarar el contrato de canal extensible: "canal N = transferencia propia + destino downstream disjunto". El fan-out ya acepta un quinto canal sin reestructurar.
3. Mantener el destino de T1 (presupuesto) estrictamente disjunto del futuro destino relacional de T5. Cuando T5 aterrice, se enchufa al grafo, jamás al presupuesto.
4. El símplex ya está indexado por organismo → forward-compatible con Modelo B: T5 podrá mapear atención→autoridad-de-estadio por organismo sin tocar el símplex.

**Dependencia de V2-P1:** T5 incluye autoridad de estadio (el protagonista impone la agenda dramática). La parte que necesita estadio-por-organismo se activa con **F5 + V2-P1**. El grafo relacional vuelve al Modelo B más potente (p. ej. `Texture(Trance) →Contaminar→ Vox(Drift)`). **V2-P1 no bloquea F2.**

---

## 12. REGISTRO DE PUNTOS DE DECISIÓN

Para cada punto: qué decide, qué consecuencia produce, frecuencia (por tick / compás / evento / transición / otra), clasificación. **Objetivo único:** responder *"¿Qué decisiones reales del sistema deben consultar la contienda de iniciativa de T2 y cuáles no?"*

### 12.1 Clasificación en cuatro grupos

**GRUPO A — T2 (INICIATIVA).** Un organismo intenta actuar/emerger/iniciar. Pregunta: *"¿Es una contienda potencial entre organismos?"* Ejemplos: `VOXDNA.tick`, `shouldEmerge`, signal bursts (L4246, ya estocástico), gestos emergentes, propuesta voluntaria.

**GRUPO B — T1 (COMPETENCIA).** Recursos finitos: presupuesto, node count, voice stealing, memoria limitada, eviction, quotas. Pregunta: *"¿Hay escasez de recurso?"*

**GRUPO C — T3 (PERSISTENCIA).** Memoria, recurrencia, fósiles, recapitulación, decay, retention. Pregunta: *"¿Decide qué sigue vivo en el tiempo?"*

**GRUPO D — NO T2/T1/T3.** Todo lo demás. Atención especial: ORCH, META, EMO, INTENTION, MIX_INTEL, SPECTRAL_PRIORITY. Determinar si pertenecen a mezcla, dramaturgia, estadio, cualidad o foco perceptual. **No forzar su entrada en T2.**

### 12.2 Winner-takes-all detectados (la caza)

| Sitio | Qué hace | Dominio | ¿Viola? | Destino |
|---|---|---|---|---|
| ORCH `sort()[0]` (L2059) | protagonista único (cualidad + `'narrative'`=vox fusionados) | mezcla + organismo | **Sí (parte organismo)** | organismo → T2; mezcla → F3; cualidad → F5 |
| META.desire `sort()[0]` (L1512) | un deseo dominante | dramaturgia | No — legítimo | F4 |
| EMO.dominant (L2432) | una emoción dominante | cualidad/estado | No — legítimo | F5 |
| INTENTION.dominant (L2412) | una intención dominante | cualidad/estado | No — legítimo | F5 |
| MIX_INTEL `_queue.sort(weight)` (L4441) | un foco perceptual ganador | mezcla/foco | No es T2, pero **es WTA en T4/F3** | reconciliar F3/T4 |
| SAL LRU (L2951) | robo de voz | recurso | No — competencia | T1 |
| PACK_MEM evict (L3988) | desalojo | recurso | No — competencia | T1 |

**El WTA oculto más peligroso para T2:** si la contienda se construye *sobre* `ORCH.protagonist`, se re-importa el argmax por la puerta de atrás. T2 deriva su probabilidad de victoria **del símplex**, nunca de ORCH.

### 12.3 Estrategia de migración (orden)

1. Definir el contrato de "punto de decisión" (contiendas discrecionales vs sustrato clockeado intocable).
2. Introducir el mecanismo de contienda como capa que los puntos *consultan* (transferencia acotada + muestreo proporcional + anti-racha). Sin remover ORCH.
3. Redirigir la emergencia de Vox para que consulte la contienda.
4. Des-fusionar ORCH: extraer protagonismo-de-organismo; el protagonista-cualidad conduce mezcla (hasta F3) pero informado por T2.
5. Introducir iniciativa discrecional de Rhythm/Texture (gestos/acentos), grid intacto.
6. Gate de regresión: con atención en split neutro y contienda activa, el sustrato clockeado debe quedar **idéntico**; solo difiere la capa discrecional.

### 12.4 Dependencias y riesgos

**Dependencias:** F1 y F2 prerequisitos duros; T2 necesita el registro; V2-P1 interactúa con la reconciliación de cualidad de ORCH en F5; T2 agnóstico a V2-P1; T1 conceptual para "propone/afford" (transición: "afford" = `BUDGET`).
**Riesgo principal (mitigación):** divergencia semántica ORCH↔T2 — ORCH conduce mezcla hasta F3, su `'narrative'` informado por T2.

---

## 13. CLÁUSULA IDIOMA-AGNÓSTICA

**T2 nunca depende de idiomas rítmicos específicos** (p. ej. IKEDA, Tango). Consume **vocabularios abstractos de acciones discrecionales** declarados **por organismo**. El idioma es *color* (ADN), no mecánica.

**Organismo ≠ ADN ≠ idioma.** Confundirlos (p. ej. "RHYTHM DNA"/"VOX DNA" que fusionan organismo + ADN + idioma + ejes ajenos) es una violación. La biblioteca de material (PACK BANK, import, DNA IDENTITY/ANCHOR/morph) es compartida y vive en el panel Material/ADN; el idioma seleccionado de cada organismo vive en el panel Organismos. El scoring/sesgo de ORCH (biases IKEDA/behavioral/DESTINY) se absorbe como **input** de la contienda de T2.

---

## 14. INVARIANTES ANTI-MONOPOLIO

El monopolio se cuela por **cinco vías**; el contrato las cierra **todas**:

1. **Compounding temporal.** Argmax repetido → ventaja modesta domina. **Solución:** contienda **estocástica/proporcional** (iniciativa = probabilidad muestreada), nunca argmax. El 0.30 gana ~30%.
2. **Argmax escondido downstream.** Prohibido argmax-sobre-iniciativa en *cualquier* consumidor. La iniciativa se consume como *distribución a muestrear*, jamás como ranking del que se toma el tope.
3. **Feedback rico-se-vuelve-más-rico.** **Flujo unidireccional** — T2 nunca realimenta el símplex (ganar no sube tu atención). La atención se fija upstream; T2 es downstream y read-only.
4. **Erosión del piso.** El piso se propaga a la iniciativa (transferencia temperada nunca→0 + muestreo proporcional) → floor *raramente, pero realmente*, gana (R4).
5. **Monopolio por racha.** **Memoria anti-racha / refractaria** — tras ganar, el standing decae temporalmente.

**Combinación:** transferencia acotada (per-contienda) + muestreo proporcional (sin argmax) + anti-racha (temporal) + flujo unidireccional → mata el monopolio **instantáneo** *y* el **emergente**.

**Invariantes constitucionales (jamás expuestos a perfiles):** forma de la transferencia y bordes (piso/techo); muestreo proporcional + prohibición de argmax; mecánica anti-racha; contratos con T1/T3; mapeo iniciativa→puntos de decisión. Ningún perfil debe poder recrear winner-takes-all.

---

## 15. PRINCIPIOS DE UI APROBADOS

**Hallazgo de cierre:** la UI actual modela un sistema de **protagonista único con Vox privilegiado y Texture casi ausente**; la constitución modela **tres organismos simétricos gobernados por un símplex de atención con fan-out.**

**Principio rector:** la navegación primaria refleja la constitución.

**Estructura de navegación v2 (A–H), aprobada como objetivo:**
- **A — ORGANISMS** — primer orden, *misma estructura* para los tres. Identidad+estado · ADN/idioma · material asignado · **solo/mute simétrico (F1)** (absorbe y deduplica VOX SOLO) · vocabulario de acciones discrecionales (T2). Absorbe RHYTHM DNA, VOX DNA, SAMPLES, ENGINE.
- **B — ATTENTION & FAN-OUT** — hogar de F2 y del fan-out. Atención símplex (tres porciones + target/migración/congelado/oscilación) · Iniciativa T2 (readout de standing — reframe de CONDUCTOR FOCUS/ENTITY y PROTO de "protagonista único" a *distribución* + perilla de estilo-de-liderazgo) · Competencia T1 (NODES 0/40 + reparto de presupuesto) · Persistencia T3 (decay/recurrencia + HOT/WARM/COLD) · Foco perceptual T4 (SPATIAL + profundidad/centro + trim acotado; **VOX PRESENCE se retira aquí** como foco) · Relaciones T5 (sub-panel **reservado**, F6).
- **C — DRAMATURGY & TIME** (Ritual Entrópico) — Modo (Pátina/Sedimentación/Desgaste) · DESTINY (Rebirth/Extinción, neutro F4) · estado global (tension/energy/WEATHER/ECOLOGY/DNA morph) · DURATION · **"RITUAL PROFILE" renombrado** (presets de sesión → "SESSION PRESET"; o perfil-gramática → atención×dramaturgia×destino×relaciones).
- **D — STAGE** — Movimiento (Emergence/Build/Peak/Collapse/Return) + morada (Trance/Drift/Silence) · **Registro (Sub/Grave/Mid/Aire)** · **Densidad** · **Autonomía consolidada** (unifica los 4 lugares dispersos) · AUTO/NEXT PHASE. Diseñar para estadio global **o** por-organismo (V2-P1).
- **E — MATERIAL / ADN** — PACK BANK + import + DNA IDENTITY/ANCHOR/morph (biblioteca compartida; idioma seleccionado vive en A).
- **F — SYSTEM / TRANSPORT** — PLAY/BPM/TAP/tempo curve · MIC/REC/IMM/SAFE · **audio-priority deduplicado a un solo lugar** · SIM MULT/sat-bar. PROTO pasa a mini-readout de *distribución de iniciativa*.
- **G — EXPORT** — CAPTURE/PRINT DNA, STATE BUS bridge.
- **H — DEBUG** — DEBUG HUD, DBG/DBG▶, STATE BUS crudo, TEST VOX.

**Correcciones obligatorias:** asimetría de organismos; Autonomía dispersa en 4 lugares (header LIVE, PERFORMANCE MODE, LAB CONSCIOUSNESS, EXPORT INSTALLATION) → consolidar; PRIORITY MODE duplicado; VOX SOLO duplica `solo` de F1; logo "v42" obsoleto (es v49); "PROTO"/"ENTITY" centran protagonista único (cara del WTA); "VOX PRESENCE" = confusión atención=volumen.

**Orden sugerido:** empezar por panel **A (Organisms)** — bajo riesgo, alto valor: materializa F1 y deduplica VOX SOLO.

**Skin canónico (v38+):** bg `linear-gradient(155deg,#13111f,#1b1726)`; border `rgba(153,68,255,.18)`; knobs SVG arc tornasolado `#00ffff→#9944ff→#ff00ff`; fonts Inter (body) + JetBrains Mono italic; **mínimo 11px**; sin íconos/símbolos Unicode (texto plano o formas CSS).

---

## 16. MIGRACIONES PENDIENTES

| Pieza | Estado | Nota |
|---|---|---|
| **F2 — Attention Simplex + fan-out** | Pendiente | Implementar símplex (current/target/floor), migración como trayectoria, fan-out T1/T2/T3/T4, trim de gain acotado |
| **Registro → T2** | Pendiente | Seguir estrategia §12.3 |
| **T2 — Iniciativa** | Pendiente | Contienda softmax limitada, anti-racha, flujo unidireccional, "propone/afford" |
| **F3 — Reconciliación de mezcla** | Pendiente | Migrar `applyLeadership`/`applyBusGains`; reconciliar MIX_INTEL (T4) |
| **F4 — Dramaturgia / DESTINY** | Pendiente | — |
| **F5 — Reconciliación cualidad ORCH (Estadio)** | Pendiente | Depende de V2-P1 |
| **F6 — T5 (Relaciones / grafo)** | Pendiente | Quinto canal; autoridad relacional + de estadio (V2-P1) |
| **F7 — Cierre del plan** | Pendiente | — |
| **UI v2 (A–H)** | Pendiente | Empezar por panel A |
| **V2-P1 (estadio global vs por-organismo)** | Pendiente | Bloquea T5-estadio y parcialmente F5; no bloquea F2 |

**Costuras marcadas (sin sorpresas):** énfasis por canal en perfiles (opcional); reconciliación ORCH-cualidad↔T2-organismo → F3/F5; iniciativa→autoridad-de-estadio → V2-P1/T5.

---

## 17. DECISIONES CONSTITUCIONALES CERRADAS

| ID | Decisión | Estado |
|---|---|---|
| **C-01** | Organismos de primer orden simétricos (Rhythm, Vox, Texture) | Ratificada |
| **C-02** | Atención ≠ Volumen; gain = último canal y el menos importante | Ratificada |
| **C-03** | Prohibición de Winner-Takes-All como protagonismo de organismo | Ratificada |
| **C-04** | Atención como Fan-out (canales con transferencia propia y destino disjunto) | Ratificada |
| **C-05** | Separación Atención / Mezcla | Ratificada |
| **C-06** | Competencia ≠ Relaciones (destinos disjuntos) | Ratificada |
| **C-07** | F1 Organismos (organismGain transparente) | Ratificada / **Implementada (v49)** |
| **C-08** | F2 Attention Simplex (current/target/floor; migración como trayectoria) | Ratificada |
| **C-09** | T2 contienda con softmax limitada; muestreo proporcional, jamás argmax | Ratificada |
| **C-10** | Invariantes anti-monopolio (cierre de las 5 vías) | Ratificada |
| **C-11** | Contratos de realización: "T2 propone / T1 afford", "T3 recurre sin contienda" | Ratificada |
| **C-12** | Cláusula idioma-agnóstica (vocabularios abstractos por organismo) | Ratificada |
| **C-13** | Separación organismo / cualidad / dramaturgia; des-fusión de ORCH (organismo→T2, mezcla→F3, cualidad→F5) | Ratificada |
| **C-14** | Costura para T5 (quinto canal, destino disjunto, símplex indexado por organismo) | Ratificada (reservada F6) |
| **C-15** | Estructura UI v2 (A–H); empezar por panel A | Ratificada (objetivo) |
| **C-16** | V2-P1 (estadio global vs por-organismo) | **Abierta / pendiente** — no bloquea F2 |

---

*Fin de BEATSONE_CONSTITUTION_v1. Status: Ratified · Version: 1.0 · Fuente única de verdad.*
