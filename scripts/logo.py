"""Otimiza a logo: reduz para 180px de altura e gera PNG + WebP."""
from PIL import Image

p = r"assets\logo.png"
im = Image.open(p).convert("RGBA")
print("original:", im.size)
im.save(r"assets\logo-original.png")            # backup
h = 180
im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
im.save(p, optimize=True)
im.save(r"assets\logo.webp", "WEBP", quality=92, method=6)
print("otimizada:", im.size)
