# Tutorial video generator

Generates the narrated, cursor-driven screencasts served from `/tutorials/*.mp4`
and embedded in the in-app Help panel (Help → 🎬 Video Tutorials, and a player at
the top of each module's help section).

Each video is produced from a **storyboard** (a list of narration lines + click
targets) in `gen-video.cjs`. The generator drives the real app in a headless
browser with stubbed data, records a silent video with an on-screen cursor and
caption banner, synthesizes per-step narration, forces each step's wall-time to
its narration length so audio lines up, then trims the pre-roll and muxes the
narration into an MP4.

## Toolchain (install once in the build environment)

```
apt-get install -y ffmpeg espeak-ng           # ffmpeg for mux/encode
pip install piper-tts                          # neural text-to-speech
# voice model (GitHub mirror; HuggingFace is often blocked):
curl -fsSL https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-lessac-medium.tar.gz \
  | tar xz -C /opt/piper-voices
```

Playwright + a Chromium build are also required (already present in CI here).

## Generate

```
NODE_PATH=/opt/node22/lib/node_modules \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
node gen-video.cjs <storyboard>      # daily | prp | schedule | trace | training | audit | auditor
```

The MP4 lands in the scratchpad; copy it to `/tutorials/tutorial-<key>.mp4`.

## Add a new tutorial (expandable)

1. Add a storyboard object to `STORYBOARDS` in `gen-video.cjs`:
   - `title`, optional `url` + `mockRest` (for a separate page like the auditor
     portal), a `setup(pg)` that installs the stub + renders the screen, and a
     `steps[]` array of `{ say, act:{type,sel,text|value} }`.
   - `act.type` is one of `move | click | type | select | fill` (or omit for a
     narration-only step).
2. Run the generator, copy the MP4 to `/tutorials/`.
3. Add a `videoCard(...)` to `SEC_VIDEO_TUTORIALS` and a `watch('tutorial-<key>.mp4')`
   at the top of the matching help section in `crm-help.js`.

## Voice

Piper `en-us-lessac-medium`. To change the voice, download a different Piper
model and point `MODEL` at it, then regenerate — every video re-synthesizes.
