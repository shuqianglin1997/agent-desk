from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

bg = (31, 35, 40, 255)
blue = (22, 101, 216, 255)
blue_light = (95, 165, 250, 255)
paper = (246, 248, 250, 255)
line = (183, 193, 203, 255)

draw.rounded_rectangle((64, 64, 960, 960), radius=220, fill=bg)
draw.rounded_rectangle((156, 190, 412, 834), radius=54, fill=(46, 54, 64, 255))
draw.rounded_rectangle((448, 190, 868, 834), radius=54, fill=paper)

for y in (282, 392, 502):
    draw.rounded_rectangle((200, y, 368, y + 46), radius=23, fill=blue if y == 282 else (112, 122, 134, 255))

for y in (282, 382, 482, 582):
    draw.rounded_rectangle((504, y, 808, y + 34), radius=17, fill=line if y != 282 else blue)

draw.rounded_rectangle((504, 690, 720, 748), radius=29, fill=blue)
draw.ellipse((764, 676, 826, 738), fill=blue_light)
draw.line((720, 720, 764, 704), fill=blue_light, width=18)

img.save(ASSETS / "icon.png")
img.save(ASSETS / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])

iconset = ASSETS / "icon.iconset"
iconset.mkdir(exist_ok=True)
sizes = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

for name, size in sizes.items():
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(iconset / name)
