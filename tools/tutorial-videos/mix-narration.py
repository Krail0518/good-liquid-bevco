"""Lay narration clips on one track at given times.

    python3 mix-narration.py events.json out.wav

events.json: {"total": seconds, "events": [{"t": start_seconds, "file": wav}]}
Used by gen-warehouse.cjs, whose captions appear at times only known after
recording, so the clips cannot simply be concatenated.
"""
import json, sys
import numpy as np
import soundfile as sf

spec = json.load(open(sys.argv[1]))
ev = spec['events']
sr = sf.info(ev[0]['file']).samplerate if ev else 24000
out = np.zeros(int(spec['total'] * sr) + sr, dtype=np.float32)
for e in ev:
    a, r = sf.read(e['file'], dtype='float32')
    if a.ndim > 1:
        a = a.mean(axis=1)
    if r != sr:
        raise SystemExit('mixed sample rates: %s is %d, expected %d' % (e['file'], r, sr))
    i = int(e['t'] * sr)
    j = min(len(out), i + len(a))
    if i < len(out):
        out[i:j] += a[:j - i]
np.clip(out, -1, 1, out=out)
sf.write(sys.argv[2], out, sr)
print('mixed %d clips into %.1fs' % (len(ev), len(out) / sr))
