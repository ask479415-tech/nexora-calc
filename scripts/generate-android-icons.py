from pathlib import Path
from PIL import Image, ImageDraw

root = Path("android/app/src/main/res")
sizes = {"mdpi":48, "hdpi":72, "xhdpi":96, "xxhdpi":144, "xxxhdpi":192}

def draw_icon(size):
    im = Image.new("RGBA", (size, size), (16, 46, 87, 255))
    d = ImageDraw.Draw(im)
    margin = int(size * .04)
    d.rounded_rectangle((margin, margin, size-margin, size-margin), radius=int(size*.23), fill=(23,77,131,255))
    cx = size / 2
    sw = max(2, int(size * .045))
    blue = (145, 211, 249, 255)
    white = (255, 255, 255, 255)
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

# Android 8+ and Android 13 adaptive launcher icon resources.
(root / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)
(root / "drawable").mkdir(parents=True, exist_ok=True)
(root / "values").mkdir(parents=True, exist_ok=True)
(root / "values" / "nexora_icon_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources><color name="nexora_icon_background">#174D83</color></resources>\n',
    encoding="utf-8"
)
foreground = '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#00000000" android:strokeColor="#91D3F9"
        android:strokeWidth="5" android:strokeLineCap="round" android:strokeLineJoin="round"
        android:pathData="M54,20 L54,39 M28,39 L80,39 M36,39 L23,68 M72,39 L85,68 M18,68 Q28,86 38,68 M70,68 Q80,86 90,68"/>
    <path android:fillColor="#00000000" android:strokeColor="#FFFFFF"
        android:strokeWidth="5" android:strokeLineCap="round"
        android:pathData="M39,88 L69,88"/>
</vector>
'''
(root / "drawable" / "ic_launcher_foreground.xml").write_text(foreground, encoding="utf-8")
adaptive = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/nexora_icon_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
'''
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    (root / "mipmap-anydpi-v26" / name).write_text(adaptive, encoding="utf-8")
