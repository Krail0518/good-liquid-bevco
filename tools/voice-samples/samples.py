"""Voice samples for the training-video narrator (Kokoro, open source, Apache-2.0).

Runs on a GitHub runner (see .github/workflows/voice-samples.yml). Writes one
MP3 per voice to tools/voice-samples/out/ and one file with all of them in a
row, so a person can listen and pick.
"""
import os, subprocess, sys
import soundfile as sf
from kokoro_onnx import Kokoro

OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)

VOICES = [
    ('af_heart',   'American, warm'),
    ('af_bella',   'American, bright'),
    ('af_nicole',  'American, soft and close'),
    ('af_sarah',   'American, clear'),
    ('af_nova',    'American, crisp'),
    ('af_jessica', 'American, friendly'),
    ('af_kore',    'American, steady'),
    ('bf_emma',    'British, polished'),
]
LINE = ("When Paul receives our pallets, he gives each one his own number. "
        "Open the transfer, click CONRI receipt, and upload his ticket. "
        "Anything that doesn't match shows up in yellow, so you can fix it before you save.")
WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

k = Kokoro(sys.argv[1], sys.argv[2])
parts = []
for i, (v, desc) in enumerate(VOICES):
    text = 'Voice ' + WORDS[i] + '. ' + LINE
    samples, sr = k.create(text, voice=v, speed=1.0, lang='en-gb' if v.startswith('b') else 'en-us')
    wav = os.path.join(OUT, '%d-%s.wav' % (i + 1, v))
    sf.write(wav, samples, sr)
    mp3 = wav[:-4] + '.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-b:a', '128k', mp3], check=True)
    parts.append(wav)
    print('made', mp3, desc)

# All eight in a row, a second of quiet between them.
lst = os.path.join(OUT, 'list.txt')
silence = os.path.join(OUT, 'gap.wav')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1.2', silence], check=True)
with open(lst, 'w') as f:
    for w in parts:
        f.write("file '%s'\nfile '%s'\n" % (os.path.basename(w), os.path.basename(silence)))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-b:a', '128k', os.path.join(OUT, 'all-voices.mp3')], cwd=OUT, check=True)
for f in os.listdir(OUT):
    if f.endswith('.wav') or f == 'list.txt':
        os.remove(os.path.join(OUT, f))
print('done')
