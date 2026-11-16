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
    """Generate wake word patterns and common phonetic variations for the given mascot name."""
    name_lower = re.sub(r'[^a-z0-9]', '', name.lower())
    aliases = {name_lower}
    if name_lower == "otto":
        aliases.update(["auto", "oto", "ottoo", "autumn", "otho", "otta", "audio", "other", "all to", "ought to"])
    patterns = []
    for alias in aliases:
        patterns.extend([
            f"hey {alias}",
            f"hi {alias}",
            f"hello {alias}",
            alias,
        ])
    return patterns

def is_wake_word_match(text, patterns):
    """Check if recognized text matches any wake word pattern or greeting."""
    normalized = re.sub(r'[^a-z0-9 ]', '', text.lower().strip())
    if not normalized:
        return False
    if any(pattern in normalized for pattern in patterns):
        return True
    # Also respond when user directly greets or addresses the mascot while voice activation is on
    words = normalized.split()
    direct_triggers = {"hey", "hi", "hello", "bello", "yo", "sup", "buddy", "minion"}
    if any(w in direct_triggers for w in words):
        return True
    return False

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
    """Check if the audio file has enough energy anywhere in the clip (not just silence)."""
    try:
        with open(filepath, 'rb') as f:
            data = f.read()
        
        # Skip WAV header (44 bytes typically)
        audio_data = data[44:]
        if len(audio_data) < 200:
            return False
        
        # Scan across the ENTIRE audio clip in windows (~0.1s = 3200 bytes at 16kHz 16-bit)
        # so speech starting after the first 0.06s is never missed!
        window_bytes = 3200
        step = 1600
        max_window_avg = 0
        
        for start in range(0, max(1, len(audio_data) - window_bytes), step):
            chunk = audio_data[start:start + window_bytes]
            # Sample every 4th sample for fast calculation
            total = 0
            count = 0
            for i in range(0, len(chunk) - 1, 8):
                val = int.from_bytes(chunk[i:i+2], 'little', signed=True)
                total += abs(val)
                count += 1
            if count > 0:
                avg = total / count
                if avg > max_window_avg:
                    max_window_avg = avg
                    if max_window_avg > 60:
                        return True
        
        return max_window_avg > 60  # Sensitive energy threshold across the whole clip
    except Exception:
        return True

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
                time.sleep(0.2)
                continue
            
            # Check if there's actual speech (not just silence)
            if not check_energy_level(audio_file):
                os.unlink(audio_file)
                continue
            
            # Recognize speech from the audio file
            try:
                with sr.AudioFile(audio_file) as source:
                    audio_data = recognizer.record(source)
                
                text = recognizer.recognize_google(audio_data)
                print(json.dumps({"status": "heard", "text": text}))
                sys.stdout.flush()
                
                if is_wake_word_match(text, patterns) or len(text.strip()) > 0:
                    print(json.dumps({"detected": True, "text": text, "name": mascot_name}))
                    sys.stdout.flush()
                    # Brief pause after detection so mascot doesn't hear its own TTS reply
                    time.sleep(2.5)
            
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
