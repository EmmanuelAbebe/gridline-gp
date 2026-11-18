# The phone-wheel app's icon: a game controller (amber on the page's dark background), drawn with PIL into every
# launcher PNG the Android project uses. Run from this folder after a change: python3 icon.py
from PIL import Image, ImageDraw

BG, FG, INK = (14, 17, 22, 255), (255, 179, 71, 255), (14, 17, 22, 255)   # theme.css --bg, --accent
RES = 'android/app/src/main/res'
DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

def controller(d, s, ox=0.0, oy=-3.0):
    """the controller in a 108-unit adaptive-icon square (safe zone 21..87), scaled by s, moved by ox / oy units"""
    P = lambda x, y: ((x + ox) * s, (y + oy) * s)
    def circle(x, y, r, fill): d.ellipse([*P(x - r, y - r), *P(x + r, y + r)], fill=fill)
    d.rounded_rectangle([*P(25, 40), *P(83, 64)], radius=12 * s, fill=FG)      # body
    circle(35, 64, 10, FG); circle(73, 64, 10, FG)                              # grips
    d.rectangle([*P(31, 49.8), *P(43, 54.2)], fill=INK)                         # D-pad
    d.rectangle([*P(34.8, 46), *P(39.2, 58)], fill=INK)
    for x, y in ((73, 47), (78, 52), (73, 57), (68, 52)): circle(x, y, 2.6, INK)   # face buttons

def render(px, adaptive, shape):
    big = px * 4
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if adaptive:                              # foreground layer only: 108 units over the whole image
        controller(d, big / 108)
    else:                                     # legacy icon: background shape + the controller in its middle
        if shape == 'round': d.ellipse([0, 0, big - 1, big - 1], fill=BG)
        else: d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.18, fill=BG)
        k = big / 74                          # the 66-unit safe zone (+ a margin) over the legacy icon
        controller(d, k, -17, -20)
    return im.resize((px, px), Image.LANCZOS)

for name, k in DENS.items():
    render(round(48 * k), False, 'square').save(f'{RES}/mipmap-{name}/ic_launcher.png')
    render(round(48 * k), False, 'round').save(f'{RES}/mipmap-{name}/ic_launcher_round.png')
    render(round(108 * k), True, None).save(f'{RES}/mipmap-{name}/ic_launcher_foreground.png')
import sys
if sys.argv[1:]: render(512, False, 'square').save(sys.argv[1])   # a 512 px preview: python3 icon.py out.png
