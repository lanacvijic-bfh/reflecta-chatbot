#!/usr/bin/env python3
"""
WhisperX ASR Service - Schnelle lokale Spracherkennung mit WhisperX
WhisperX bietet bessere Performance und wortgenaue Zeitstempel
"""
import sys
import json
import base64
import tempfile
import os
from pathlib import Path

try:
    import whisperx
    import torch
except ImportError:
    print(json.dumps({"error": "WhisperX nicht installiert. Bitte installieren: pip install whisperx"}, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)

# Globale Variablen für Modell-Caching (verhindert mehrfaches Laden)
_model_cache = {}
_device = "cuda" if torch.cuda.is_available() else "cpu"
_compute_type = "float16" if _device == "cuda" else "int8"

def transcribe_audio(audio_data_base64: str, language: str = "de", model_size: str = "base") -> dict:
    """
    Transkribiert Audio-Daten mit WhisperX
    
    Args:
        audio_data_base64: Base64-kodierte Audio-Daten (WAV, MP3, etc.)
        language: Sprachcode (z.B. "de" für Deutsch)
        model_size: Modellgröße ("tiny", "base", "small", "medium", "large")
    
    Returns:
        Dict mit "text", "language" und optional "error", "word_timestamps"
    """
    try:
        # Base64 dekodieren
        audio_bytes = base64.b64decode(audio_data_base64)
        
        # Temporäre Datei erstellen
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
            tmp_file.write(audio_bytes)
            tmp_path = tmp_file.name
        
        try:
            # Modell-Caching: Lade Modell nur einmal
            model_key = f"{model_size}_{language}"
            if model_key not in _model_cache:
                print(f"Lade WhisperX Modell: {model_size} (Device: {_device})", file=sys.stderr)
                _model_cache[model_key] = whisperx.load_model(
                    model_size, 
                    _device, 
                    compute_type=_compute_type,
                    language=language
                )
            
            model = _model_cache[model_key]
            
            # Audio laden
            audio = whisperx.load_audio(tmp_path)
            
            # Transkribieren
            result = model.transcribe(audio, batch_size=16)
            
            # Alignment für wortgenaue Zeitstempel (optional, aber empfohlen)
            try:
                model_a, metadata = whisperx.load_align_model(language_code=language, device=_device)
                result = whisperx.align(result["segments"], model_a, metadata, audio, _device, return_char_alignments=False)
            except Exception as align_error:
                # Falls Alignment fehlschlägt, verwende Standard-Ergebnis
                print(f"Alignment-Warnung (wird übersprungen): {align_error}", file=sys.stderr)
            
            # Text extrahieren (kombiniere alle Segmente)
            text = " ".join([segment["text"].strip() for segment in result["segments"]]).strip()
            
            # Optional: Wort-Zeitstempel extrahieren (falls verfügbar)
            word_timestamps = []
            if result.get("segments"):
                for segment in result["segments"]:
                    if "words" in segment and segment["words"]:
                        word_timestamps.extend(segment["words"])
            
            response = {
                "text": text,
                "language": language,
                "device": _device
            }
            
            # Füge Wort-Zeitstempel hinzu, falls verfügbar
            if word_timestamps:
                response["word_timestamps"] = word_timestamps
            
            return response
            
        finally:
            # Temporäre Datei löschen
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
    except Exception as e:
        return {"error": str(e), "device": _device}


if __name__ == "__main__":
    # JSON von stdin lesen
    try:
        input_data = json.load(sys.stdin)
        audio_base64 = input_data.get("audio")
        language = input_data.get("language", "de")
        model_size = input_data.get("model_size", "base")  # Optional: Modellgröße
        
        if not audio_base64:
            print(json.dumps({"error": "Keine Audio-Daten bereitgestellt"}, ensure_ascii=False))
            sys.exit(1)
        
        result = transcribe_audio(audio_base64, language, model_size)
        print(json.dumps(result, ensure_ascii=False))
        
    except json.JSONDecodeError:
        print(json.dumps({"error": "Ungültiges JSON-Format"}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Fehler: {str(e)}"}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

