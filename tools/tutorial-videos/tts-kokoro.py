"""Narration for the tutorial videos with Kokoro (open source, Apache-2.0).

    python3 tts-kokoro.py jobs.json

jobs.json is a list of [text, output.wav]. The model loads once for the whole
list, so a 40-step video does not pay the load 40 times.

Environment:
  GL_KOKORO_MODEL   path to kokoro-v1.0.onnx            (required)
  GL_KOKORO_VOICES  path to voices-v1.0.bin             (required)
  GL_TTS_VOICE      Kokoro voice, default af_heart (voice 1, chosen 2026-10-18)
  GL_TTS_SPEED      speaking rate, default 1.0
"""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

k = Kokoro(os.environ['GL_KOKORO_MODEL'], os.environ['GL_KOKORO_VOICES'])
voice = os.environ.get('GL_TTS_VOICE', 'af_heart')
speed = float(os.environ.get('GL_TTS_SPEED', '1.0'))
lang = 'en-gb' if voice.startswith('b') else 'en-us'
for text, out in json.load(open(sys.argv[1])):
    samples, sr = k.create(text, voice=voice, speed=speed, lang=lang)
    sf.write(out, samples, sr)
print('kokoro: %d lines, voice %s' % (len(json.load(open(sys.argv[1]))), voice))
