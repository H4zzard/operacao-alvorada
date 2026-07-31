"""Recorta o fundo BRANCO da foto de estúdio do Everton (seção Mentor).

Mesma ideia do cutout.py, invertida: lá o fundo era preto, aqui é branco de
estúdio. Só o branco CONECTADO À BORDA vira transparência — assim qualquer
respingo claro dentro do sujeito (reflexo no colete, dente, olho) fica intacto.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1]
OUT = sys.argv[2]
MAXW = 1100

im = Image.open(SRC).convert("RGB")
print("original:", im.size)

a = np.asarray(im).astype(np.float32)
luma = a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114
chroma = a.max(axis=2) - a.min(axis=2)          # branco/cinza tem chroma baixo

# 1) candidatos a fundo: claro e sem cor.
#    O ciclorama não é branco chapado — tem vinheta e cai para ~180 nos cantos,
#    por isso o corte de luma é baixo. Quem segura o sujeito é a CHROMA: pele
#    (~90) e camuflado (~60) passam longe do cinza neutro do fundo (<34).
light = (luma > 160) & (chroma < 34)

# 2) o que encosta na borda é fundo de verdade
lbl, nl = ndimage.label(light)
border = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
border = border[border != 0]

# 2b) …mas há bolsões de ciclorama ILHADOS, sem caminho até a borda: o vão entre
#     o cotovelo e o colete se fecha quando o braço encosta no corpo. Eles também
#     são fundo. O critério é ser claro e grande — pele e camuflado nem chegam
#     aqui, porque o filtro de chroma já os excluiu de `light`.
if nl:
    idx = np.arange(1, nl + 1)
    lum_med = ndimage.mean(luma, lbl, idx)
    area = ndimage.sum(light, lbl, idx)
    ilhas = idx[(lum_med > 192) & (area > 400)]
    border = np.union1d(border, ilhas)

bg = np.isin(lbl, border)

# 2b) buracos ENCLAUSURADOS (ex.: o triângulo de fundo entre o braço e o tronco,
#     com as mãos na cintura) não encostam na borda, então o passo anterior os
#     deixa opacos. Fechar tudo com binary_fill_holes devolveria aquele retalho
#     branco. Então: cada buraco é avaliado — se for majoritariamente cor de
#     fundo, continua transparente; se não, é ruído interno e é preenchido.
subject = ~bg
filled = ndimage.binary_fill_holes(subject)
holes = filled & ~subject

lblh, nh = ndimage.label(holes)
if nh:
    idx = np.arange(1, nh + 1)
    frac_light = ndimage.mean(light.astype(np.float32), lblh, idx)
    solid = idx[frac_light <= .60]              # buraco que não é fundo -> tapa
    subject |= np.isin(lblh, solid)

# 3) fica só o maior componente: mata respingos soltos do ciclorama, que além de
#    sujar a imagem puxavam o bbox e descentralizavam o Everton no card.
lbls, ns = ndimage.label(subject)
if ns > 1:
    sizes = ndimage.sum(subject, lbls, np.arange(1, ns + 1))
    subject = lbls == (int(np.argmax(sizes)) + 1)

# 4) alpha: encolhe 1px (mata a franja branca) e suaviza a borda
alpha = ndimage.binary_erosion(subject, iterations=1).astype(np.float32)
alpha = ndimage.gaussian_filter(alpha, sigma=1.1)
alpha = np.clip((alpha - .35) / .45, 0, 1)

# 5) despill: escurece a borda contaminada pelo branco do estúdio
edge = (alpha > .05) & (alpha < .95)
a[edge] = np.clip(a[edge] * .84, 0, 255)

out = Image.fromarray(np.dstack([a, alpha * 255]).astype(np.uint8), "RGBA")

# 6) recorta no sujeito e devolve a MOLDURA SIMÉTRICA: o bbox sozinho encosta na
#    silhueta, e como ele não é simétrico o Everton descia para um dos lados
#    dentro do card. Aqui a largura é centrada no centro de massa horizontal.
bbox = out.getbbox()
out = out.crop(bbox)

cx = round(np.average(np.arange(out.width), weights=np.asarray(out)[..., 3].sum(axis=0) + 1e-6))
meia = max(cx, out.width - cx)
canvas = Image.new("RGBA", (meia * 2, out.height), (0, 0, 0, 0))
canvas.alpha_composite(out, (meia - cx, 0))
out = canvas

if out.width > MAXW:
    out = out.resize((MAXW, round(out.height * MAXW / out.width)), Image.LANCZOS)

out = out.quantize(colors=192, method=Image.FASTOCTREE)
out.save(OUT, optimize=True)
print("recortado:", out.size)
