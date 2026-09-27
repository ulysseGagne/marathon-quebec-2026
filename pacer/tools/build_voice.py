"""Render the pacer's spoken phrases to small MP3 clips (pacer/voice/*.mp3).

The app plays these clips through Web Audio in a "transient" audio session, which on
iOS mixes with Apple Music instead of pausing it (the built-in speechSynthesis takes the
audio exclusively and stops the music). Voice: Piper en_US-joe-medium (CC0), offline.

    pip install piper-tts joe-us-piper-voice lameenc numpy
    python3 pacer/tools/build_voice.py          # only clips that are missing
    python3 pacer/tools/build_voice.py --all    # everything again (synthesis varies a bit)
"""
import io
import json
import os
import sys
import wave

import lameenc
import numpy as np
from piper import PiperVoice, SynthesisConfig
import joe_us_piper_voice as joe

OUT = os.path.join(os.path.dirname(__file__), '..', 'voice')


def phrases():
    p = {}
    for n in range(1, 100):
        unit = 'second' if n == 1 else 'seconds'
        p[f'b{n}'] = f'{n} {unit} behind.'
        p[f'a{n}'] = f'{n} {unit} ahead.'
    p['pace'] = 'On pace.'
    p['about'] = 'About'
    for n in range(1, 10):
        p[f'm{n}'] = f'{n} minute' if n == 1 else f'{n} minutes'
    p['behind'] = 'behind.'
    p['ahead'] = 'ahead.'
    p['bar'] = 'Time for a bar.'
    p['go'] = 'Go!'
    p['go_run'] = 'Go. Pacer running.'
    p['live_wait'] = 'Live mode. Waiting for the gun.'
    p['rehearsal'] = 'Live rehearsal. The gun is in one minute.'
    p['chip'] = 'Chip time.'
    p['stopped'] = 'Pacer stopped.'
    p['finish'] = 'Finish.'
    p['every250'] = 'Every 250 meters.'
    p['every500'] = 'Every 500 meters.'
    p['every1000'] = 'Every kilometer.'
    p['every2000'] = 'Every 2 kilometers.'
    p['offpace'] = 'Only when off pace.'
    return p


def render(voice, text, cfg):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        voice.synthesize_wav(text, w, syn_config=cfg)
    buf.seek(0)
    with wave.open(buf) as w:
        rate = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x, rate


def loud(x, rate):
    # trim silence (keep 30 ms), bring speech to about -15 dBFS RMS, soft-limit the peaks
    env = np.convolve(np.abs(x), np.ones(int(rate * 0.01)) / (rate * 0.01), mode='same')
    on = np.where(env > 0.01)[0]
    if len(on):
        pad = int(rate * 0.03)
        x = x[max(0, on[0] - pad):min(len(x), on[-1] + pad)]
    rms = np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2)) if np.any(np.abs(x) > 0.01) else 0.1
    x = x * (0.18 / max(rms, 1e-4))
    x = np.tanh(x * 1.1) / np.tanh(1.1)
    fade = int(rate * 0.008)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x


def mp3(x, rate):
    enc = lameenc.Encoder()
    enc.set_bit_rate(40)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    return enc.encode(pcm) + enc.flush()


def main():
    os.makedirs(OUT, exist_ok=True)
    voice = PiperVoice.load(joe.model_path(), config_path=joe.config_path())
    cfg = SynthesisConfig(length_scale=0.95)
    everything = '--all' in sys.argv
    try:
        with open(os.path.join(OUT, 'index.json')) as f:
            index = json.load(f)
    except FileNotFoundError:
        index = {}
    total = 0
    for key, text in phrases().items():
        path = os.path.join(OUT, f'{key}.mp3')
        if not everything and key in index and os.path.exists(path):
            continue
        x, rate = render(voice, text, cfg)
        x = loud(x, rate)
        data = mp3(x, rate)
        with open(os.path.join(OUT, f'{key}.mp3'), 'wb') as f:
            f.write(data)
        index[key] = round(len(x) / rate, 2)
        total += len(data)
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    print(f'{len(index)} clips ({total / 1e6:.2f} MB written now), {sum(index.values()):.0f} s of speech')


if __name__ == '__main__':
    main()
