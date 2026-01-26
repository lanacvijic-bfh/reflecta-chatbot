# WhisperX Installation Guide

## Schnellstart

```bash
# 1. WhisperX installieren
pip install whisperx

# 2. Optional: GPU-Unterstützung (CUDA)
# Nur wenn Sie eine NVIDIA GPU haben und CUDA installiert ist
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
```

## Systemanforderungen

- **Python**: 3.8 oder höher
- **RAM**: Mindestens 4GB (8GB+ empfohlen)
- **GPU**: Optional, aber empfohlen für bessere Performance
  - NVIDIA GPU mit CUDA 11.8+ für GPU-Beschleunigung
  - Funktioniert auch auf CPU (langsamer)

## Installation Details

### Basis-Installation (CPU)

```bash
pip install whisperx
```

### GPU-Installation (CUDA)

1. **CUDA Toolkit installieren** (falls noch nicht vorhanden):
   - Windows: https://developer.nvidia.com/cuda-downloads
   - Linux: `sudo apt-get install nvidia-cuda-toolkit`
   - Mac: Nicht unterstützt (nur CPU)

2. **PyTorch mit CUDA installieren**:
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
```

3. **WhisperX installieren**:
```bash
pip install whisperx
```

## Testen der Installation

```bash
# Testen Sie, ob WhisperX korrekt installiert ist
python -c "import whisperx; print('WhisperX erfolgreich installiert!')"

# Testen Sie die GPU-Unterstützung (falls vorhanden)
python -c "import torch; print(f'CUDA verfügbar: {torch.cuda.is_available()}')"
```

## Modellgrößen

WhisperX unterstützt die gleichen Modellgrößen wie Whisper:

| Modell | Größe | Geschwindigkeit (CPU) | Geschwindigkeit (GPU) | Qualität |
|--------|-------|----------------------|----------------------|----------|
| `tiny` | ~40MB | Sehr schnell | Sehr schnell | Niedrig |
| `base` | ~150MB | Schnell | Sehr schnell | Gut (empfohlen) |
| `small` | ~500MB | Mittel | Schnell | Sehr gut |
| `medium` | ~1.5GB | Langsam | Mittel | Ausgezeichnet |
| `large-v2` | ~3GB | Sehr langsam | Langsam | Beste |

**Empfehlung**: Verwenden Sie `base` für die beste Balance zwischen Geschwindigkeit und Qualität.

## Verwendung

Das Script `whisper_asr.py` verwendet automatisch:
- GPU, falls verfügbar
- CPU als Fallback
- Modell-Caching (Modell wird nur einmal geladen)

Sie können die Modellgröße im JSON-Request angeben:
```json
{
  "audio": "base64_encoded_audio",
  "language": "de",
  "model_size": "base"
}
```

## Fehlerbehebung

### "No module named 'whisperx'"
```bash
pip install whisperx
```

### "CUDA out of memory"
- Verwenden Sie ein kleineres Modell (`tiny` oder `base`)
- Reduzieren Sie die Batch-Größe in `whisper_asr.py` (Zeile mit `batch_size=16`)

### Langsame Performance auf CPU
- Das ist normal - WhisperX ist auf CPU langsamer als auf GPU
- Verwenden Sie `tiny` oder `base` Modell für bessere Performance
- GPU-Beschleunigung wird dringend empfohlen

### "Alignment model not found"
- Das Alignment ist optional - das Script funktioniert auch ohne
- Die Warnung kann ignoriert werden

## Performance-Vergleich

| Setup | 10 Sekunden Audio | 60 Sekunden Audio |
|-------|------------------|-------------------|
| Whisper base (CPU) | ~2-3 Sekunden | ~12-18 Sekunden |
| WhisperX base (CPU) | ~0.5-1.5 Sekunden | ~3-9 Sekunden |
| WhisperX base (GPU) | ~0.1-0.3 Sekunden | ~0.6-1.8 Sekunden |

**WhisperX ist 2-4x schneller als Standard-Whisper!**

## Datenschutz

✅ **Alle Daten bleiben lokal**: WhisperX läuft komplett auf Ihrem Server
✅ **Keine Internet-Verbindung erforderlich**: Nach dem ersten Modell-Download
✅ **Open Source**: Vollständig transparent und überprüfbar
✅ **GDPR-konform**: Perfekt für sensible Daten (z.B. medizinische Gespräche)

