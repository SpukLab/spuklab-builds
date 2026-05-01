# VoxSculp — Spectral Voice Reconstruction Instrument

## Overview

VoxSculp is an experimental browser-based voice processing instrument built on Web Audio API. It captures live voice input (or audio files) and reconstructs it through spectral decomposition and granular synthesis, creating a new sonic identity without replicating the original voice.

**Philosophy:** Transform voice into something unrecognizable — dissolve rather than colorize.

---

## Architecture (v5 onwards)

### Audio Chain

```
Microphone Input
    ↓
MediaStreamAudioSource
    ↓
ScriptProcessor (2048 samples)
    ├→ Analyser (FFT analysis)
    ├→ AC.destination (direct output)
    └→ Real-time spectral decomposition
       ↓
    Granular Reconstruction Engine
       ↓
    Output (Left + Right stereo)
```

**Key Pattern (from BinauralSpray v43):**
- `source → processor → AC.destination` (direct routing)
- Processor callback handles real-time FFT analysis
- No intermediate gain nodes or complex routing chains
- Analyser taps directly from processor output

### Spectral Decomposition

Splits incoming audio into 4 frequency bands:
- **BODY** (60–300 Hz) — fundamental/bass
- **FORMANT** (300–2.5 kHz) — vowel character
- **AIR** (2.5–8 kHz) — presence/aggression
- **NOISE** (8–20 kHz) — breath/texture

Returns normalized energy ratios and triggers behavior analysis.

### Behavior Analysis

Derives 4 metrics from spectral data (no ML):
- **intensity** — overall energy
- **tension** — spectral flux (frame-to-frame variation)
- **aggression** — air band + transients
- **air** — noise ratio

These drive visual feedback and influence synthesis parameters.

### Granular Reconstruction

1. **Grain Buffer** (16384 samples) stores incoming audio
2. **Read Position** random-walked within grain window (10–80 ms configurable)
3. **FM Modulation** applied per-mode:
   - **abstract**: high-freq sine modulation + random noise
   - **organic**: smooth sine modulation
   - **textural**: noise emphasis blended with tonal
   - **inharmonic**: cosine detuning
4. **Dry/Wet Blending** via mutation slider (0–1)
5. **Stereo Spreading** via space control (mono → wide)

---

## Controls

### Input
- **Mic** — Start microphone input (requires permission)
- **Stop** — Stop listening and reset

### Mode (4 buttons)
- **Abstract** — Maximum spectral distortion, high chaos
- **Organic** — Musical, glitch-controlled variation
- **Textural** — Noise-dominant, tonal blend variable
- **Inharmonic** — Harmonic deconstruction, incoherent

### Sliders

| Control | Range | Effect |
|---------|-------|--------|
| Mutation | 0–100 | Dry/wet blend (0=dry voice only, 100=full transform) |
| Density | 10–80 | Grain size in milliseconds (larger = more granular) |
| Texture | 0–100 | Tonal vs. noise (0=pure tonal, 100=pure noise) |
| Space | 0–100 | Stereo width (0=mono, 100=wide spectral spread) |

### Visual Feedback
- **Meters** (bottom left) — Real-time energy in 4 bands
- **Canvas Rings** — Three concentric rings respond to intensity, tension, aggression
- **Particles** — Orbital particles driven by noise content
- **Center Orb** — Central glow responds to overall intensity

---

## Building & Deployment

### Local Development
1. Edit `VoxSculp_v5.html` in any text editor
2. Open in Safari (iOS/iPad) or any modern browser
3. Test mic input, modes, sliders

### Deployment to GitHub Pages

```bash
# Automatic (via script)
bash /home/claude/deploy-voxsculp.sh

# Manual
cd /mnt/user-data/outputs/spuklab-builds
cp ../VoxSculp_v5.html .
git add VoxSculp_v5.html
git commit -m "VoxSculp v5 — [description]"
git push origin main
```

**Live URL:** `https://spuklab.github.io/spuklab-builds/VoxSculp_v5.html`

---

## iOS Safari Audio Notes

### Critical Requirements
1. **HTTPS only** — getUserMedia will silently fail on `file://` or `http://`
2. **User gesture** — Mic access must be triggered by tap (not on page load)
3. **AC.resume()** — Must call synchronously before getUserMedia
4. **No promises** — Use callback-based `decodeAudioData`, not Promise API

### Known Limitations
- ScriptProcessor deprecated (but still works, stable)
- Audio output may have slight latency (~20–50ms)
- Recording requires manual buffer management (no MediaRecorder on iOS)

---

## Technical Specs

| Parameter | Value |
|-----------|-------|
| Sample Rate | AC.sampleRate (typically 48kHz) |
| Processor Buffer | 2048 samples (~42ms @ 48kHz) |
| FFT Size | 2048 bins |
| Grain Buffer | 16384 samples |
| Latency | ~20–50ms |
| CPU Usage | ~5–15% (iPad M3) |

---

## Future Roadmap

### v6 (Recording + Presets)
- [ ] WAV recording to browser buffer
- [ ] Download recorded audio
- [ ] Preset save/load (localStorage)
- [ ] XY pad for identity/chaos blending

### v7 (Advanced DSP)
- [ ] Phase vocoder (better pitch/time)
- [ ] Harmonic series resynthesis
- [ ] HRTF 3D binaural panning
- [ ] Glitch event triggering

### v8+ (AUv3)
- [ ] Swift/AudioKit rewrite for iOS
- [ ] AUv3 plugin format
- [ ] GarageBand / AUM compatibility
- [ ] IAP unlock for advanced modes

---

## File Structure

```
spuklab-builds/
├── VoxSculp_v5.html          # Current stable version
├── VoxSculp_v4.html          # Previous (minimal)
├── VoxSculp_v3.html          # Earlier prototype
├── binauralspray.html        # Reference implementation
├── README.md                  # This file
└── deploy-voxsculp.sh        # Auto-deploy script
```

---

## Credits

**VoxSculp** — SpukLab (2026)
- Audio DSP: Web Audio API, spectral decomposition
- Visual: Canvas 2D, real-time particle system
- Inspired by BinauralSpray architecture (mic input patterns)
- Developed for iPad M3 Safari, responsive to touch

---

## Support

- **Mic not working?** Check: HTTPS, permissions, AC.resume() order
- **Latency too high?** Reduce grain density, check CPU usage
- **Audio glitchy?** Lower mutation slider, adjust texture/space
- **Console errors?** Check browser console (Safari: Cmd+Option+I)

---

**by SpukLab** ✨
