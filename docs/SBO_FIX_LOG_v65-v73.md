# SBO FIX LOG — v65 a v73 (pack import / voice pipeline audit)

**Período:** 2026-06-15 a 2026-06-17
**Disparador:** piano1_g2_v01_spukpack.zip cargaba "ALL BOUND 13/13" pero nunca
se escuchaban las voces del pack importado — solo el ruido de siempre.
**Resultado:** 7 fixes reales encontrados y corregidos en SBO. El "ruido de
siempre" remanente después de los 7 fixes resultó ser **contenido real** del
pack (confirmado escuchando los `.wav` extraídos del zip, fuera de SBO por
completo) — no un bug de SBO. La investigación de esa causa se trasladó a
Sound Forge (ver sección final).

Antes de leer este log: cargar `BEATSONE_CONSTITUTION_v1.md` →
`ARCHITECTURE_DECISIONS.md` → este archivo, en ese orden.

---

## Resumen ejecutivo

| # | Síntoma | Causa raíz | Archivo:línea (v73) | Fix |
|---|---|---|---|---|
| P0 | Voces nunca pasaban el gate de fase narrativa | `VOX_ARC.phaseWeight()` no tenía el mismo bypass que `allows()` cuando había pack de voces cargado | `VOX_ARC.phaseWeight` | v66 |
| P3 | Voces nunca entraban al top-3 de selección | `VOXMEM.score()`: `wAffinities` nunca incluye `command`/`ritual` en ninguna lista de clima | `VOXMEM.score` | v67 |
| — | **Causa raíz central**: packs "ALL BOUND" pero solo ruido | `_decodeDataURL` usaba `fetch(dataURL)` sobre URLs `data:` — devuelve los bytes ASCII crudos del string, no el binario decodificado | `_decodeDataURL` | v72 |
| — | Imposible saber si un REJECTED de `fire()` significaba silencio real | Los fallbacks legacy (`_legacyNarrativeFire`/`_legacyGhostFire`) ignoran todos los gates de `fire()` | instrumentación | v66, v68 |
| — | Imposible aislar decode/buffer de scheduler/bus | No existía forma de escuchar un fragmento sin pasar por todo el motor | `DNACENTER.playRaw` | v69-v71, v73 |

---

## P0 — VOX_ARC.phaseWeight inconsistente (v66)

**Síntoma:** con un pack de voces cargado, `command`/`ritual` deberían sonar
siempre ("VOICE ALWAYS LEGIBLE", política ya documentada). En la práctica solo
sonaban de forma confiable durante CLIMAX (fase narrativa .55–.78).

**Causa raíz:** `VOX_ARC.allows(entityType)` ya tenía un bypass explícito:
`if(SAL.voxReady>0)return true` con el comentario *"voice types always
allowed — don't gate on narrative arc phase"*. Pero `VOX_ARC.phaseWeight()`
—usado inmediatamente después en `fire()` para una segunda probabilidad de
paso— no tenía ese bypass. Seguía leyendo una tabla por fase
(`OPENING/DEVELOPMENT/CLIMAX/MEMORY`) donde `command` valía 0/.3/.9/.1 según
la fase narrativa, dando una probabilidad de paso real de 35–100% en vez del
100% que la política pretendía.

**Fix:** `phaseWeight()` ahora replica el mismo bypass: si
`(entityType==='command'||'ritual') && SAL.voxReady>0`, devuelve `.7` fijo
(→ `arcW+.25=.95` de probabilidad de paso), independientemente de la fase.

**Verificado:** sí, por VOXTRACE — cero rechazos por `VOX_ARC_WEIGHT` después
del fix.

---

## P3 — VOXMEM.score nunca daba bonus de clima a voces (v67)

**Síntoma:** con P0 corregido, las voces seguían sin sonar. VOXTRACE mostró
que `ritual_voice_a`/`b` **nunca entraban al top-3** de `_pickReadyFragment`
en 8+ minutos de sesión — solo 4 fragmentos `fragType='ghost'`
(`collapse_residue`, `memory_trace`, `semantic_ghost_a/b`) rotaban entre sí
con score ~1.01–1.05.

**Causa raíz:** `VOXMEM.score()` tiene una tabla `wAffinities` que da +0.28 de
bonus de afinidad climática:
```js
var wAffinities={VOID:['collapse_residue','ghost'],STORM:['collapse_residue'],
                  FOG:['subconscious','breath'],CLEAR:['texture','breath']};
```
`command`/`ritual` **no aparecen en ninguna de las 4 listas, bajo ningún
clima**. `ritual_voice_a` (spawnProb 0.11) llegaba a score≈0.56; el clúster
ghost, con el bonus, llegaba a ~1.0+. Nunca era competitivo.

**Fix:** mismo patrón de bypass que P0 — si `(type==='command'||'ritual') &&
SAL.voxReady>0`, otorgar el mismo +0.28 incondicionalmente.

**Verificado:** sí — tras el fix, `ritual_voice_a` apareció por primera vez en
VOXTRACE con score 0.83-0.84 (0.11+0.45+0.28), compitiendo y ganando
selección.

---

## CAUSA RAÍZ CENTRAL — fetch(dataURL) en _decodeDataURL (v72)

**Síntoma:** con P0+P3 corregidos, `ritual_voice_a` ganaba selección y se
disparaba (confirmado en VOXTRACE como `PLAYED`/`legacy_narrative`) — pero
seguía sin escucharse nada reconocible como piano.

**Diagnóstico:** se construyó el botón `TEST VOICE A` (v69-v71, ver más abajo)
para reproducir el buffer decodificado de un fragmento directo a destino, sin
scheduler/bus/organismo. Resultado: sonaba **ruido**, no piano — pero medía
peak=0.0193, idéntico al peak real medido offline en el `.wav` original
(confirmando que el decode SÍ producía un buffer con datos no-cero). El
contenido del buffer estaba mal, no ausente.

**Causa raíz:**
```js
const resp = await fetch(dataURL);   // dataURL = "data:audio/wav;base64,...."
const ab   = await resp.arrayBuffer();
```
`fetch()` sobre una URL `data:` **no decodifica el base64** en todos los
navegadores/contextos — devuelve los bytes ASCII crudos del string completo
(incluyendo el prefijo literal `"data:audio/wav;base64,"`).
`ac.decodeAudioData(ab)` recibe esos bytes ASCII, los interpreta como PCM
binario corrupto, y produce un `AudioBuffer` de **duración correcta** (porque
alcanza a leer algo del header WAV embebido más adelante en el string) pero
con **valores de muestra sin relación al audio real**. Esto explica
exactamente el patrón observado en toda la historia de SBO:
`slot.ready=true` ✓, `ALL BOUND 13/13` ✓, `peak` no-cero ✓, pero **siempre
ruido al reproducir**, sin importar el pack.

**Fix:**
```js
if(dataURL.startsWith('data:')){
  const comma=dataURL.indexOf(',');
  const b64=dataURL.slice(comma+1);
  const bin=atob(b64);
  ab=new ArrayBuffer(bin.length);
  const view=new Uint8Array(ab);
  for(let i=0;i<bin.length;i++)view[i]=bin.charCodeAt(i);
}else{
  const resp=await fetch(dataURL); ab=await resp.arrayBuffer(); // no-data: URLs sin cambios
}
```
Decodificación manual de base64 vía `atob()`+`Uint8Array`, bypaseando
`fetch()` por completo para URLs `data:`.

**Verificado:** sí, de forma muy directa — pack de diagnóstico
`diag_bitdepth.spukpack` (mismo tono de 440Hz exportado en 16-bit/24-bit/
32-float) probado en DNA CENTER PLAY RAW post-fix: los tres formatos suenan
limpios. Esto también descartó la hipótesis previa (bug de WebKit en decode
de 24-bit) — el problema nunca fue el bit-depth.

**Impacto:** este es probablemente el bug más importante de toda la sesión.
Afecta a **todo pack importado**, en **todo momento de la historia de SBO**
desde que existe el pipeline de import — no solo a piano1_g2_v01.

---

## Instrumentación — VOXTRACE + cobertura de fallbacks legacy (v66, v68)

**Por qué hizo falta:** sin esto, cada hipótesis sobre el pipeline era pura
inferencia de lectura de código, sin datos empíricos.

**VOXTRACE** (`const VOXTRACE`, definido junto a `VOX_ARC`): log circular de
las últimas 12 decisiones de `fire()` para `command`/`ritual`, con
`id`/`reason`/`score`/`phase`. Surgido en SNAPSHOT → SESSION LOG.

**Hallazgo crítico sobre los fallbacks (v68):** un `REJECTED` en VOXTRACE
**no significa silencio**. `_legacyNarrativeFire`/`_legacyGhostFire` se
ejecutan cuando `fire()` devuelve `false`, y **no repiten ninguno de los
gates de `fire()`** (ni `minInterval`, ni `MIX_INTEL`, ni `VOX_ARC`, ni
`BUDGET`) — solo chequean `slot.ready&&slot.buffer&&ac`. Esto se confirmó
en vivo: `ritual_voice_a` aparecía como `REJECTED reason=MIN_INTERVAL` en una
línea, y `PLAYED type=legacy_narrative` en la siguiente, mismo timestamp.
v68 instrumentó ambos fallbacks para que VOXTRACE refleje lo que realmente
se escucha, no solo lo que `fire()` decidió.

---

## Herramientas de diagnóstico construidas (v69-v73)

### TEST VOICE buttons (v69-v71, en LAB) — ya superseded por DNA CENTER
Botones de reproducción cruda (`AudioBufferSource→Gain→destination`, bypass
total de scheduler/bus/organismo) para `ritual_voice_a` y, después, para el
pack de diagnóstico de bit-depth. Useful en su momento; la funcionalidad
ahora vive de forma generalizada en DNA CENTER (PANEL 3).

### DNA CENTER — AUDIT MODE (v73)
Tab nueva (7ma, junto a LAB). Consola de diagnóstico puro — **no toca
scheduler, scoring, phaseWeight, weatherAffinity, VOX_ARC, decode, ni
parsing de ZIP.**

- **PANEL 1 — PACK INSPECTOR:** por pack en `PACK_MEM.bank` — estado
  (HOT/WARM/COLD), entidades, bound, ready, errores de decode, memoria — todo
  leído en vivo de `SAL.voxSlots`.
- **PANEL 2 — ENTITY INSPECTOR:** tabla por entidad — id/type/file/duración/
  canales/samplerate/peak/rms/ready. Todos los valores numéricos vienen del
  `AudioBuffer` real decodificado, nunca de metadata del manifest.
- **PANEL 3 — DIRECT AUDITION:** PLAY RAW/STOP para la entidad seleccionada,
  cadena estricta `AudioBufferSource→Gain→destination`. Gain ajustable.
- **PANEL 4 — AUDIO ANALYZER:** peak/rms/crest factor/dc offset/zero crossing
  rate/centroide espectral (FFT radix-2 propia, ventana centrada de hasta
  16384 muestras — ver limitación abajo)/duración. Botón EXPORT ANALYSIS
  (JSON descargable).
- **PANEL 5 — ACTIVITY MONITOR:** últimos 100 eventos de reproducción real
  (timestamp/id/path), alimentado por `fire()` éxito + ambos fallbacks legacy
  + los propios triggers de DNA CENTER. Solo hechos, sin interpretación.
- **SOLO/MUTE/GAIN** para RHYTHM/VOX/TEXTURE (extiende `ORGANISM.{id}` con un
  campo `manualGain` nuevo, default 1, retrocompatible). **FIELD se muestra
  solo como medidor de lectura** — está conectado directamente a
  `ORGANISM.rhythm.gain` por decisión arquitectónica ya existente en el
  código ("FIELD pressure bed owned by Rhythm... never own"); darle gain
  propio contradiría eso, así que no se implementó.
- **4 TESTS** — oscilador interno 440Hz (sin WAV) / PLAY RAW / PLAY vía
  `VOX_ENTITY.fire()` directo / comparación RAW vs SCHEDULER con un
  `AnalyserNode` como tap pasivo sobre `BUS.get('ghost')`.

**Limitación conocida del analizador (PANEL 4):** el centroide espectral usa
una ventana FFT centrada de hasta 16384 muestras (~7% de un buffer de 5s a
44.1kHz). Para señales muy dispersas (ej. `memory_trace`, eventos aislados en
silencio), si el evento real cae fuera de esa ventana central, el centroide
puede salir en 0 por el fallback explícito del código (`den>0?num/den:0`) sin
que eso signifique que el archivo no tiene contenido espectral. No
interpretar `spectralCentroidHz:0` como hallazgo sin antes verificar dónde
cae el evento dentro del buffer.

---

## ⚠️ Conflicto de nombres pendiente — "DNA CENTER"

`ADR-017` (este mismo documento, `docs/ARCHITECTURE_DECISIONS.md`) ya
reserva el nombre **"DNA CENTER"** para una de las 4 tabs planeadas en la
reorganización por intención operativa — destinada a controles de
**identidad** (5 perfiles ORG/SIG/MASS/GEO/SIL, RITUAL PROFILE, DNA
IDENTITY/ANCHOR). La tab construida en v73 (este documento) usa el **mismo
nombre** para una consola de **diagnóstico/auditoría**, sin relación con
identidad.

Esto no es un bug — ambas tabs fueron pedidas explícitamente por nombre en
sus respectivos momentos — pero es una colisión real que hay que resolver
antes de implementar ADR-017: alguna de las dos va a necesitar otro nombre
(sugerencia: la diagnóstica podría pasar a llamarse "AUDIT" o "DIAGNOSTICS",
dejando "DNA CENTER" libre para el uso que ADR-017 ya le asignó).

---

## Pendiente — P1 (no implementado, fuera de alcance de esta tanda)

`weatherAffinity` y `preferredPhase`, presentes en el manifest de cada
entidad importada, **siguen sin ser leídos por ningún punto de scoring o
scheduling**. Confirmado por grep exhaustivo en sesiones previas: los únicos
usos son de almacenamiento (import) y un diagnóstico de comparación (`BRIDGE`
degraded flag). Esto significa que packs distintos con metadata distinta
suenan parecido en términos de *cuándo* emergen — la única variación real
hoy viene de `rhythmDNA.bridge` (timbre sintetizado) y `spawnProbability`
(frecuencia), no de afinidad climática/de fase declarada por el pack.

Requiere reconciliar 3 vocabularios de fase/clima competentes (`PE.PHASES`
8 valores, `VOX_ARC` 4 fases, `ecology.narrativeStates` 8 estados,
`DESTINY.zone`, `WEATHER_TYPES` 6 valores) antes de diseñar el mapeo. No
iniciado.

---

## RESUELTO — investigación trasladada a Sound Forge (confirmado)

Después de los 7 fixes de SBO, el "ruido" remanente en entidades `ghost`
(`semantic_ghost_a/b`) se confirmó **escuchando los `.wav` extraídos
directamente del `.zip`, fuera de SBO por completo** — era contenido real del
archivo exportado, no un bug de reproducción.

Auditoría forense en Sound Forge (`sound-forge-p33.html`) confirmó
numéricamente: `_renderSemanticGhost()` usaba
`ruido→highpass→3×allpass→saturación` — los allpass en serie no esculpen
magnitud espectral (solo fase), dejando ruido de banda ancha crudo después
del highpass (ZCR=0.557, centroide=13.5kHz, casi idéntico al ruido blanco de
`spectral_click`).

**Pregunta que quedaba abierta:** si esa función (parte del Entity Catalog
viejo, botón FORGE PACK / `forgeSpukPack→buildEntityCatalog`) es la que
generó `piano1_g2_v01`, o si Bank Export la usa como relleno automático.
**Respuesta confirmada por la sesión de Sound Forge:** el Entity Catalog
(`forgeSpukPack→buildEntityCatalog`) está **confirmado independiente** de
Bank Export (`exportFragmentBank`) — Bank Export **nunca toca ese código**.
Es decir: el ruido en `piano1_g2_v01` vino del botón FORGE PACK viejo, no del
flujo de trabajo real actual del usuario. El pack nuevo generado vía Bank
Export (`.spukpack`, en curso) no puede heredar este bug específico, porque
corre por un camino de código completamente distinto.

**Fix aplicado (commit `369706e`, Sound Forge):**
1. `_renderSemanticGhost`: agregado lowpass resonante (2000–4000Hz, Q1.8)
   entre el highpass y la cascada de allpass. Verificado numéricamente:
   ZCR 0.557→0.144, centroide 13517→3277Hz, distancia espectral a
   `spectral_click` 0.075→0.741 (de "casi idéntico" a "territorio de shimmer
   real, no hiss").
2. `_renderRitualVoice`: vibrato de pitch sutil (4-6Hz, ~3.5% de profundidad)
   en el segundo formante — el audit encontró a `ritual_voice` cerca de
   `erosion_texture` en huella espectral+duración (d=0.058-0.064); el
   vibrato es un rasgo de FM vocal que el tremolo (solo AM) de
   `erosion_texture` no tiene.

**Estado:** cerrado para el Entity Catalog viejo. Sin impacto en el flujo de
trabajo real del usuario (Bank Export), que nunca pasó por este código.

---

## Estado de versión actual

`SpukBeatsOne-v73.html` — todos los fixes de este log integrados. Próximo
trabajo de feature (post-consolidación): a decidir entre F2 attentionSimplex,
MATERIAL tab (ADR-017), o extensión de DNA CENTER (prioridad manual por
entidad + discourse builder).
