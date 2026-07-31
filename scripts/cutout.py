"""Remove o fundo preto do PNG do professor (recorte real, com borda suavizada)."""
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"assets\professor.png"
BAK = r"assets\professor-original.png"
OUT = r"assets\professor.png"
MAXW = 1800

im = Image.open(SRC).convert("RGB")
im.save(BAK)                      # guarda o original antes de sobrescrever
print("original:", im.size)

a = np.asarray(im).astype(np.float32)
luma = a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114

# 1) candidatos a fundo: quase preto
dark = luma < 30

# 2) só o preto CONECTADO À borda é fundo (preserva camisa/colete escuros do Everton)
lbl, n = ndimage.label(dark)
border = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
border = border[border != 0]
bg = np.isin(lbl, border)

# fecha buracos pequenos que sobraram dentro do sujeito
subject = ndimage.binary_fill_holes(~bg)

# 3) alpha: encolhe 1px (mata a franja preta) e suaviza a borda
alpha = ndimage.binary_erosion(subject, iterations=1).astype(np.float32)
alpha = ndimage.gaussian_filter(alpha, sigma=1.2)
alpha = np.clip((alpha - .35) / .45, 0, 1)

# 4) despill: clareia levemente os pixels de borda contaminados pelo preto
edge = (alpha > .05) & (alpha < .95)
a[edge] = np.clip(a[edge] * 1.18, 0, 255)

rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
out = Image.fromarray(rgba, "RGBA")

# 5) recorta o excesso transparente e reduz para tamanho web
bbox = out.getbbox()
out = out.crop(bbox)
if out.width > MAXW:
    out = out.resize((MAXW, round(out.height * MAXW / out.width)), Image.LANCZOS)

out.save(OUT, optimize=True)
print("recortado:", out.size)
