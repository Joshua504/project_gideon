#!/usr/bin/env python3
"""
Voice Activation Helper for Desktop Mascot Companion
Listens for wake words using arecord + SpeechRecognition (Google API).
Outputs JSON lines to stdout when wake words are detected.

Usage:
    python3 voice_activation.py <mascot_name>

Output format (JSON lines):
    {"status": "ready"}                    - Script started and listening
    {"status": "error", "message": "..."}  - Error occurred
    {"detected": true, "text": "..."}      - Wake word detected
"""

import sys
import os
import json
import subprocess
import time
import tempfile
import re
import speech_recognition as sr

def get_wake_word_patterns(name):
    """Generate wake word patterns for the given mascot name."""
    name_lower = name.lower()
    return [
        f"hey {name_lower}",
        f"hi {name_lower}",
        f"hello {name_lower}",
        name_lower,
    ]

def is_wake_word_match(text, patterns):
    """Check if recognized text matches any wake word pattern."""
    normalized = re.sub(r'[^a-z0-9 ]', '', text.lower().strip())
    return any(pattern in normalized for pattern in patterns)

def record_audio(duration=3, sample_rate=16000):
    """Record audio from microphone using arecord and return the temp file path."""
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    
    try:
        proc = subprocess.run(
            [
                "arecord",
                "-f", "S16_LE",
                "-r", str(sample_rate),
                "-c", "1",
                "-d", str(duration),
                tmp.name
            ],
            capture_output=True,
            timeout=duration + 2
        )
        if proc.returncode == 0 and os.path.getsize(tmp.name) > 0:
            return tmp.name
        else:
            os.unlink(tmp.name)
            return None
    except subprocess.TimeoutExpired:
        os.unlink(tmp.name)
        return None
    except Exception:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
        return None

def check_energy_level(filepath):
    """Check if the audio file has enough energy (not just silence)."""
    try:
        with open(filepath, 'rb') as f:
            data = f.read()
        
        # Skip WAV header (44 bytes typically)
        audio_data = data[44:]
        if len(audio_data) < 100:
            return False
        
        # Sample some bytes to check energy
        sample_size = min(2000, len(audio_data))
        samples = audio_data[:sample_size]
        
        # Calculate average amplitude
        total = 0
        for i in range(0, len(samples) - 1, 2):
            val = int.from_bytes(samples[i:i+2], 'little', signed=True)
            total += abs(val)
        
        avg = total / (sample_size // 2)
        return avg > 100  # Energy threshold
    except Exception:
        return False

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Usage: voice_activation.py <mascot_name>"}))
        sys.exit(1)
    
    mascot_name = sys.argv[1]
    patterns = get_wake_word_patterns(mascot_name)
    
    print(json.dumps({"status": "ready", "name": mascot_name}))
    sys.stdout.flush()
    
    recognizer = sr.Recognizer()
    
    # Calibrate ambient noise
    try:
        cal_file = record_audio(duration=2)
        if cal_file:
            with sr.AudioFile(cal_file) as source:
                audio = recognizer.record(source)
            recognizer.energy_threshold = 300
            print(json.dumps({"status": "calibrated"}))
            sys.stdout.flush()
            os.unlink(cal_file)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Calibration skipped: {e}"}))
        sys.stdout.flush()
    
    print(json.dumps({"status": "listening", "name": mascot_name}))
    sys.stdout.flush()
    
    # Continuous listening loop
    listen_duration = 3  # seconds per listen cycle
    
    while True:
        try:
            # Record a chunk of audio
            audio_file = record_audio(duration=listen_duration)
            
            if audio_file is None:
                time.sleep(0.5)
                continue
            
            # Check if there's actual speech (not just silence)
            if not check_energy_level(audio_file):
                os.unlink(audio_file)
                time.sleep(0.5)
                continue
            
            # Recognize speech from the audio file
            try:
                with sr.AudioFile(audio_file) as source:
                    audio_data = recognizer.record(source)
                
                text = recognizer.recognize_google(audio_data)
                print(json.dumps({"status": "heard", "text": text}))
                sys.stdout.flush()
                
                if is_wake_word_match(text, patterns):
                    print(json.dumps({"detected": True, "text": text, "name": mascot_name}))
                    sys.stdout.flush()
                    # Pause after detection to avoid re-triggering
                    time.sleep(3)
            
            except sr.UnknownValueError:
                pass  # Could not understand - just continue listening
            except sr.RequestError as e:
                print(json.dumps({"status": "error", "message": f"Speech service error: {e}"}))
                sys.stdout.flush()
                time.sleep(2)
            finally:
                if os.path.exists(audio_file):
                    os.unlink(audio_file)
        
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.stdout.flush()
            time.sleep(1)

if __name__ == "__main__":
    main()
