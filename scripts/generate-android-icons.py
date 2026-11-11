from pathlib import Path
from PIL import Image, ImageDraw
import math

root = Path("android/app/src/main/res")
sizes = {"mdpi":48, "hdpi":72, "xhdpi":96, "xxhdpi":144, "xxxhdpi":192}

def draw_icon(size):
    im = Image.new("RGBA", (size, size), (16, 46, 87, 255))
    d = ImageDraw.Draw(im)
    # Rounded-square background and a clean blue-and-white weighing scale mark.
    margin = int(size * .04)
    d.rounded_rectangle((margin, margin, size-margin, size-margin), radius=int(size*.23), fill=(23,77,131,255))
    cx = size/2
    sw = max(2, int(size*.045))
    blue = (145, 211, 249, 255)
    white = (255,255,255,255)
    d.line((cx, size*.19, cx, size*.37), fill=blue, width=sw)
    d.line((size*.27,size*.37,size*.73,size*.37), fill=blue, width=sw)
    d.line((size*.35,size*.37,size*.23,size*.65), fill=blue, width=sw)
    d.line((size*.65,size*.37,size*.77,size*.65), fill=blue, width=sw)
    d.arc((size*.12,size*.53,size*.47,size*.77), 0, 180, fill=blue, width=sw)
    d.arc((size*.53,size*.53,size*.88,size*.77), 0, 180, fill=blue, width=sw)
    d.line((size*.36,size*.79,size*.64,size*.79), fill=white, width=sw)
    return im

for density, size in sizes.items():
    folder = root / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = draw_icon(size)
    icon.save(folder / "ic_launcher.png")
    icon.save(folder / "ic_launcher_round.png")
