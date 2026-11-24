import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SPRITES = ROOT / "src" / "yard" / "sprites.js"
CANVAS_SIZE = 20
BACKGROUND = "#f6f0d7"
WINDOWS_SIZES = (16, 24, 32, 48, 64, 128, 256)
MAC_SIZES = (32, 64, 128, 256, 512, 1024)


def orange_cat_pixels():
    result = subprocess.run(
        [
            "node", "-e",
            """
            const { YardSprites } = require(process.argv[1]);
            const pixels = [];
            const ctx = { fillRect(x, y) { pixels.push([x, y, this.fillStyle]); } };
            YardSprites.drawCat(ctx, YardSprites.SIT, YardSprites.BREEDS.orange, {
              dx: 2, dy: 2, scale: 1
            });
            process.stdout.write(JSON.stringify(pixels));
            """,
            str(SPRITES),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def main():
    pixels = orange_cat_pixels()
    master = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), BACKGROUND)
    draw = ImageDraw.Draw(master)
    for x, y, color in pixels:
        draw.point((x, y), fill=color)

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS_SIZE} {CANVAS_SIZE}" shape-rendering="crispEdges">',
        '  <!-- Generated from the orange SIT sprite in src/yard/sprites.js. -->',
        f'  <rect width="{CANVAS_SIZE}" height="{CANVAS_SIZE}" fill="{BACKGROUND}"/>',
    ]
    by_color = {}
    for x, y, color in pixels:
        by_color.setdefault(color, []).append(f"M{x} {y}h1v1h-1z")
    svg.extend(f'  <path fill="{color}" d="{" ".join(paths)}"/>' for color, paths in by_color.items())
    (ASSETS / "icon.svg").write_text("\n".join([*svg, "</svg>", ""]), encoding="utf-8")

    sizes = set(WINDOWS_SIZES + MAC_SIZES)
    frames = {size: master.resize((size, size), Image.Resampling.NEAREST) for size in sizes}
    frames[1024].save(ASSETS / "icon.png")
    frames[256].save(
        ASSETS / "icon.ico",
        sizes=[(size, size) for size in WINDOWS_SIZES],
        append_images=[frames[size] for size in WINDOWS_SIZES],
    )
    frames[1024].save(ASSETS / "icon.icns", append_images=[frames[size] for size in MAC_SIZES])


if __name__ == "__main__":
    main()
