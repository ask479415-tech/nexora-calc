from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path("android/app/src/main/res")
sizes = {"mdpi":48, "hdpi":72, "xhdpi":96, "xxhdpi":144, "xxxhdpi":192}

def font(size, bold=True):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def draw_icon(size):
    # High-contrast Nexora Digital identity, composed for small Android launcher sizes.
    im = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    d = ImageDraw.Draw(im)
    m = int(size * .025)
    d.rounded_rectangle((m, m, size-m, size-m), radius=int(size*.22),
                        fill=(250, 253, 255, 255), outline=(0, 105, 235, 255), width=max(1,int(size*.025)))
    # Blue/cyan N monogram.
    f_n = font(int(size*.43))
    box = d.textbbox((0,0), "N", font=f_n, stroke_width=0)
    nw, nh = box[2]-box[0], box[3]-box[1]
    d.text((size*.10, size*.06), "N", font=f_n, fill=(12, 62, 190, 255), stroke_width=max(0,int(size*.004)))
    # Green/cyan orbit sweep.
    d.arc((size*.12,size*.04,size*.91,size*.77), 205, 330, fill=(0,205,92,255), width=max(2,int(size*.045)))
    d.arc((size*.22,size*.02,size*.94,size*.70), 205, 325, fill=(0,177,245,255), width=max(2,int(size*.025)))
    # Camera lens / scan target.
    cx, cy, r = int(size*.78), int(size*.28), int(size*.105)
    d.rounded_rectangle((cx-r*1.25,cy-r*1.25,cx+r*1.25,cy+r*1.25), radius=int(r*.35), fill=(19,43,72,255))
    d.ellipse((cx-r,cy-r,cx+r,cy+r), fill=(239,249,255,255), outline=(25,105,230,255), width=max(1,int(size*.018)))
    d.ellipse((cx-r*.72,cy-r*.72,cx+r*.72,cy+r*.72), fill=(15,93,210,255), outline=(0,205,255,255), width=max(1,int(size*.012)))
    d.ellipse((cx-r*.22,cy-r*.22,cx+r*.22,cy+r*.22), fill=(8,34,100,255))
    # Calculator and tally card simplified for legibility.
    x0,y0,x1,y1 = int(size*.19),int(size*.48),int(size*.53),int(size*.78)
    d.rounded_rectangle((x0,y0,x1,y1), radius=int(size*.045), fill=(14,43,84,255), outline=(60,145,235,255), width=max(1,int(size*.012)))
    d.rounded_rectangle((x0+int(size*.035),y0+int(size*.025),x1-int(size*.035),y0+int(size*.09)),
                        radius=int(size*.012), fill=(225,246,255,255))
    for row in range(3):
        for col in range(3):
            xx=x0+int(size*(.07+col*.105)); yy=y0+int(size*(.14+row*.085))
            rr=max(1,int(size*.018))
            d.rounded_rectangle((xx-rr,yy-rr,xx+rr,yy+rr),radius=rr//2,fill=(65,145,245,255))
    # Tally card and total.
    a,b,c,e=int(size*.57),int(size*.50),int(size*.90),int(size*.78)
    d.rounded_rectangle((a,b,c,e), radius=int(size*.025), fill=(255,255,255,255), outline=(25,85,170,255), width=max(1,int(size*.012)))
    for i in range(3):
        yy=b+int(size*(.065+i*.055))
        d.line((a+int(size*.045),yy,c-int(size*.045),yy), fill=(22,58,112,255), width=max(1,int(size*.012)))
    d.rounded_rectangle((a+int(size*.025),e-int(size*.085),c-int(size*.025),e-int(size*.025)),
                        radius=int(size*.014), fill=(116,226,65,255))
    # Brand name, readable at launcher scale.
    d.text((size*.50,size*.805), "NEXORA", font=font(int(size*.105)), fill=(8,31,111,255), anchor="mm", stroke_width=0)
    d.text((size*.50,size*.91), "DIGITAL", font=font(int(size*.065)), fill=(20,166,45,255), anchor="mm", stroke_width=0)
    return im

for density, size in sizes.items():
    folder = root / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = draw_icon(size)
    icon.save(folder / "ic_launcher.png")
    icon.save(folder / "ic_launcher_round.png")

# Android 8+ adaptive launcher icon.
(root / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)
(root / "drawable").mkdir(parents=True, exist_ok=True)
(root / "values").mkdir(parents=True, exist_ok=True)
(root / "values" / "nexora_icon_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources><color name="nexora_icon_background">#FAFDFF</color></resources>\n',
    encoding="utf-8"
)
foreground = '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#0C3EBE" android:pathData="M18,78 L18,25 L31,25 L69,65 L69,25 L86,25 L86,82 L72,82 L35,44 L35,82 Z"/>
    <path android:fillColor="#00000000" android:strokeColor="#16A62D" android:strokeWidth="4"
        android:strokeLineCap="round" android:pathData="M13,77 Q48,105 91,51"/>
    <path android:fillColor="#00000000" android:strokeColor="#00B1F5" android:strokeWidth="3"
        android:strokeLineCap="round" android:pathData="M30,16 Q92,-2 96,43"/>
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
