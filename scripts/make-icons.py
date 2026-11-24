import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SPRITES = ROOT / "src" / "yard" / "sprites.js"
CANVAS_SIZE = 20
BACKGROUND = "#f6f0d7"


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

    # 只出方形原图 icon.svg 和 icon.png。带圆角的 icon.ico、icon.icns、icon-rounded.png
    # 由 scripts/make-rounded-icons.js 生成，这里不再写，免得把圆角版盖回方的。
    master.resize((1024, 1024), Image.Resampling.NEAREST).save(ASSETS / "icon.png")


if __name__ == "__main__":
    main()
