"""Генерує власні спрайтшити (PNG) і звуки (WAV) для гри. python3 scripts/make-assets.py"""
import math, struct, wave, random, json, os
from PIL import Image, ImageDraw
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
os.makedirs(out, exist_ok=True)

# ships.png: 2 кадри 48x48 (без полум'я, з полум'ям) × 2 кольори
img = Image.new('RGBA', (96, 96), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
for row, col in enumerate([(127, 209, 255), (255, 159, 127)]):
    for fr in range(2):
        ox, oy = fr * 48 + 24, row * 48 + 24
        if fr:
            d.polygon([(ox-10, oy-5), (ox-22, oy), (ox-10, oy+5)], fill=(255, 179, 71))
        d.polygon([(ox+16, oy), (ox-12, oy-10), (ox-7, oy), (ox-12, oy+10)], fill=col, outline=(232, 246, 255))
img.save(os.path.join(out, 'ships.png'))

# rocks.png: 3 розміри в одному рядку, комірка 64x64
img = Image.new('RGBA', (192, 64), (0, 0, 0, 0)); d = ImageDraw.Draw(img); rnd = random.Random(3)
for i, r in enumerate([19, 28, 37]):
    cx = i * 64 + 32
    pts = [(cx + math.cos(a) * r * rnd.uniform(.8, 1), 32 + math.sin(a) * r * rnd.uniform(.8, 1))
           for a in [k * 2 * math.pi / 10 for k in range(10)]]
    d.polygon(pts, fill=(80, 70, 58), outline=(201, 178, 143))
img.save(os.path.join(out, 'rocks.png'))

# fx.png: куля, pickup×3 (16x16)
img = Image.new('RGBA', (64, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
d.ellipse((5, 5, 11, 11), fill=(255, 246, 176))
for i, c in enumerate([(110, 231, 255), (255, 224, 102), (255, 143, 224)]):
    x = 16 * (i + 1); d.rectangle((x + 2, 2, x + 13, 13), outline=c, width=2)
img.save(os.path.join(out, 'fx.png'))

def wav(name, secs, fn, rate=22050):
    with wave.open(os.path.join(out, name), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        n = int(secs * rate); rnd = random.Random(1)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, fn(i / rate, i / n, rnd))) * 20000)) for i in range(n)))
wav('shoot.wav', .12, lambda t, k, r: math.sin(2 * math.pi * (900 - 600 * k) * t) * (1 - k))
wav('hit.wav', .08, lambda t, k, r: (r.random() * 2 - 1) * (1 - k) * .7)
wav('explode.wav', .6, lambda t, k, r: (r.random() * 2 - 1) * (1 - k) ** 2)

manifest = {
  "version": 1,
  "images": {"ships": "assets/ships.png", "rocks": "assets/rocks.png", "fx": "assets/fx.png"},
  "sounds": {"shoot": "assets/shoot.wav", "hit": "assets/hit.wav", "explode": "assets/explode.wav"},
  "json": {"arena": "assets/arena.json"}
}
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=2)
json.dump({"w": 1280, "h": 720, "asteroids": 5, "homingAsteroids": 1}, open(os.path.join(out, 'arena.json'), 'w'), indent=2)
print('ok', sorted(os.listdir(out)))
