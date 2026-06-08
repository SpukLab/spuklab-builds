# SPUKLAB_ARCHITECTURE_DECISIONS

**Bitácora técnica de decisiones (ADR) — SpukBeatsOne / Gramática Ritual v1**
**Complemento de:** SPUKLAB_CONSTITUTION_v1.md
**Propósito:** registrar *por qué* se tomó cada decisión arquitectónica, no solo *qué*. Fuente de verdad sobre intención y trade-offs. No resumir ni reinterpretar.

> Cada decisión: contexto → decisión → razón → consecuencias → estado. Estados: `Aceptada`, `Implementada`, `Reservada`, `Pendiente`.

---

## AD-001 — Creación de Organismos (F1)

**Estado:** Implementada (v49).
**Contexto:** El sistema no tenía entidades de primer orden; los buses eran funcionales sueltos y Vox estaba privilegiado.
**Decisión:** Congelar tres organismos (Rhythm, Vox, Texture) como entidades de primer orden **simétricas**, cada uno con su `organismGain` transparente (1.0). Los buses funcionales viven dentro de organismos. Insertar 3 organism sub-bus gains entre buses funcionales y `masterGain` en `BUS.init` (nodeCount 21→24), con solo/mute simétrico.
**Razón:** Habilitar que el símplex de atención y los canales actúen sobre entidades simétricas. Sin organismos de primer orden, el resto de la gramática no tiene sujeto.
**Consecuencias:** Topología lista para F2. Prerequisito duro de F2. La UI debe materializar la simetría (panel A) y deduplicar VOX SOLO.

---

## AD-002 — Attention Simplex (F2)

**Estado:** Aceptada (no implementada).
**Contexto:** Hacía falta una representación única de "a quién atiende el ritual".
**Decisión:** Atención = símplex normalizado por organismo (`{rhythm,vox,texture}`, suma 1.0) con `current` / `target` / `floor(ε)`, como **fuente única centralizada**. Migración modelada como **trayectoria gobernada del target** (migrar / congelar=Meseta / oscilar=Péndulo), con límite de velocidad angular.
**Razón:** Una sola fuente de verdad evita estados de atención contradictorios; la trayectoria unifica tres comportamientos en un solo mecanismo.
**Consecuencias:** Indexado por organismo → forward-compatible con Modelo B (V2-P1). Habilita el fan-out (AD-004).

---

## AD-003 — Eliminación de Winner-Takes-All

**Estado:** Aceptada (constitucional).
**Contexto:** El sistema operaba como protagonista único (ORCH `resolveProtagonist`, argmax/`sort()[0]`).
**Decisión:** Prohibir el winner-takes-all **como mecanismo de protagonismo de organismo**. Un 0.70 inicia más, pero los demás siguen iniciando. WTA de cualidad/deseo/emoción (META/EMO/INTENTION) se reconoce **legítimo** en su dominio (dramaturgia/estadio) y no se toca.
**Razón:** El monopolio mata la ecología de tres organismos; pero no toda dominancia es ilegítima (una emoción dominante está bien).
**Consecuencias:** Define la caza de WTA (registro §10.2) y las reglas anti-monopolio (AD-009). Obliga a des-fusionar ORCH (AD-007).

---

## AD-004 — Atención como Fan-out (separación de canales)

**Estado:** Aceptada (no implementada).
**Contexto:** Riesgo de traducir la atención a una sola cosa (volumen) o a "más de todo".
**Decisión:** La atención es un **fan-out** a cuatro canales (T1 Competencia, T2 Iniciativa, T3 Persistencia, T4 Foco perceptual), cada uno con **transferencia propia**, **destino disjunto** y **resolución temporal propia**. Quinto canal (T5 Relaciones) reservado.
**Razón:** Garantiza no-mezcla: mismo input, salidas no correlacionadas. Evita que la atención sea una perilla de volumen disfrazada.
**Consecuencias:** Cada canal se diseña por separado (AD-006, T1/T3/T4). Contrato de canal extensible para T5 (AD-008).

---

## AD-005 — Cláusula Idioma-Agnóstica

**Estado:** Aceptada (constitucional).
**Contexto:** Riesgo de acoplar la iniciativa a idiomas rítmicos (IKEDA, Tango).
**Decisión:** T2 **nunca** depende de idiomas específicos; consume **vocabularios abstractos de acciones discrecionales** declarados por organismo. Organismo ≠ ADN ≠ idioma. El scoring/sesgo de ORCH (biases IKEDA/behavioral/DESTINY) se absorbe como *input* de la contienda, no como pick-único.
**Razón:** Mantener la mecánica de iniciativa estable aunque cambien los idiomas/ADN (que son color).
**Consecuencias:** La UI separa organismo (panel A) de biblioteca de material/ADN (panel E).

---

## AD-006 — Separación Atención / Mezcla (gain como último canal)

**Estado:** Aceptada.
**Contexto:** "VOX PRESENCE" trataba atención como volumen.
**Decisión:** ATENCIÓN ≠ VOLUMEN. La capa de decisión y la de mezcla son disjuntas. El **gain** es el sub-canal último de T4 y está **topeado** (cap interno, nunca expuesto). VOX PRESENCE se reconceptualiza como **foco** (T4).
**Razón:** La atención debe gobernar decisiones, no traducirse primariamente a volumen; el gain es la traducción menos importante.
**Consecuencias:** F3 maneja la mezcla; T4 el foco; el trim de gain queda acotado y privado.

---

## AD-007 — Contienda T2 (Iniciativa) con Softmax limitada

**Estado:** Aceptada (no implementada). Canal primario.
**Contexto:** La contienda de iniciativa entre tres organismos **no existe hoy** (solo Vox tiene iniciativa real; ORCH es WTA de cualidad para mezcla).
**Decisión:** Iniciativa = standing en contiendas, derivado de atención por **redistribución conjunta compresiva con concentración temperada (softmax limitada)** entre **piso** y **techo** explícitos. Consumo por **muestreo proporcional, jamás argmax**. Crear iniciativa discrecional nueva para Rhythm/Texture (gestos/acentos sobre grid intacto). T2 es read-only sobre la atención (flujo unidireccional).
**Razón:** Softmax limitada satisface R1–R4 a la vez (piso y techo por construcción, orden y spread perceptibles, nunca 0 ni 1). Su temperatura mapea a `focusSpread`.
**Consecuencias:** Habilita anti-monopolio (AD-009). Define contratos "T2 propone / T1 afford" y "T3 recurre sin contienda" (AD-010).

---

## AD-008 — Costura para T5 (Relaciones) — Reservada

**Estado:** Reservada (F6).
**Contexto:** Las relaciones (influencia dirigida: Excitar/Suprimir/Contaminar/Diferenciar) llegan en F6 y dependen de V2-P1.
**Decisión:** Dejar la costura sin construir: publicar `current` como lectura estable; declarar el contrato de canal extensible ("canal N = transferencia propia + destino disjunto"); mantener el destino de T1 (presupuesto) disjunto del futuro grafo relacional; aprovechar el símplex indexado por organismo para el Modelo B.
**Razón:** Competencia ≠ Relaciones debe preservarse desde ahora para no tener que reestructurar al aterrizar T5.
**Consecuencias:** Sub-panel reservado en UI (B). Activación con F5 + V2-P1.

---

## AD-009 — Reglas Anti-Monopolio (cierre de las cinco vías)

**Estado:** Aceptada (constitucional).
**Contexto:** El monopolio puede reaparecer aunque la transferencia sea acotada.
**Decisión:** Cerrar las cinco vías: (1) compounding temporal → contienda estocástica/proporcional; (2) argmax escondido downstream → prohibir argmax-sobre-iniciativa en todo consumidor; (3) rico-se-vuelve-más-rico → flujo unidireccional (T2 no realimenta atención); (4) erosión del piso → piso propagado a iniciativa; (5) monopolio por racha → memoria anti-racha/refractaria.
**Razón:** Mata el monopolio instantáneo *y* el emergente. Estos son invariantes constitucionales — ningún perfil puede recrear WTA.
**Consecuencias:** Define qué expone T2 a perfiles (solo sesgo de liderazgo / rotación) y qué queda interno.

---

## AD-010 — Contratos de realización entre canales (no-colapso)

**Estado:** Aceptada.
**Contexto:** Iniciativa, presupuesto y memoria derivan de la misma atención → riesgo de correlación perfecta = "más de todo".
**Decisión:** Mantenerlos distintos por curva, resolución temporal y semántica, con contratos explícitos: **"T2 propone, T1 afford"** (acción se realiza solo si ganada-por-iniciativa **y** costeada-por-presupuesto) y **"T3 recurre sin contienda nueva"** (la recurrencia de memoria no pasa por T2).
**Razón:** Genera tensión genuina (alta iniciativa + bajo presupuesto = propone pero no ejecuta) en lugar de colapso.
**Consecuencias:** Litmus de no-colapso: deben existir estados con sentido donde los canales divergen.

---

## AD-011 — Convivencia transitoria con ORCH (des-fusión diferida)

**Estado:** Aceptada.
**Contexto:** `ORCH.protagonist` fusiona qué cualidad lidera + qué organismo lidera + aplicación de mezcla.
**Decisión:** T2 extrae **solo** la parte-organismo (des-argmaxeada). La aplicación de mezcla (`applyLeadership`/`applyBusGains`) queda para **F3**; la selección de cualidad/estado para **F5**. Durante F2, ORCH sigue conduciendo mezcla, pero su candidato `'narrative'`(=vox) queda **informado por** T2.
**Razón:** Destinos disjuntos (decisión vs mezcla) permiten migrar sin romper el audio; informar `'narrative'` evita incoherencia grosera.
**Consecuencias:** Reconciliación plena en F3/F5. Riesgo de divergencia semántica tolerado en el interín.

---

## AD-012 — Auditoría UI y estructura v2 (A–H)

**Estado:** Aceptada como objetivo (no implementada).
**Contexto:** La UI modela protagonista único con Vox privilegiado y Texture casi ausente; dominios constitucionales dispersos; conceptos mezclados y duplicados.
**Decisión:** Adoptar navegación A–H que refleja la constitución: A Organisms (simétrico), B Attention & Fan-out (hogar de F2/T2/T3/T4 + ranura T5), C Dramaturgy & Time, D Stage, E Material/ADN, F System/Transport, G Export, H Debug. Renombrar "RITUAL PROFILE", retirar "VOX PRESENCE" a foco, consolidar Autonomía, deduplicar PRIORITY MODE y VOX SOLO.
**Razón:** La navegación primaria debe reflejar la verdad arquitectónica para escalar a F6.
**Consecuencias:** Empezar por panel A (bajo riesgo, materializa F1). Hogar futuro de F2–T5 dentro de B.

---

## AD-013 — V2-P1: Estadio global vs por-organismo (Modelo B)

**Estado:** Pendiente.
**Contexto:** El estadio puede ser global o estado interno por organismo (Modelo B).
**Decisión:** Marcar V2-P1 como decisión transversal. **Bloquea T5-estadio y parcialmente F5. No bloquea F2.** El símplex indexado por organismo deja a T5 preparado para Modelo B.
**Razón:** Resolverla mal condiciona F5/T5; resolverla ahora no es necesario para F2.
**Consecuencias:** Diseñar Stage (panel D) para renderizar global o por-organismo. Decidir antes de F5/T5.

---

*Fin de SPUKLAB_ARCHITECTURE_DECISIONS. Bitácora viva — añadir AD-014+ a medida que se tomen decisiones.*
