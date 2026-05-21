"""Trim logo mark and export Deflector extension toolbar icons."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "ui" / "assets" / "logo.png"
MARK = ROOT / "src" / "ui" / "assets" / "logo-mark.png"
ICONS = ROOT / "icons"
ICONS.mkdir(exist_ok=True)
PAD = 6


def alpha_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    alpha = img.split()[-1]
    return alpha.getbbox() or (0, 0, img.width, img.height)


def trim_mark(img: Image.Image) -> Image.Image:
    left, top, right, bottom = alpha_bbox(img)
    left = max(0, left - PAD)
    top = max(0, top - PAD)
    right = min(img.width, right + PAD)
    bottom = min(img.height, bottom + PAD)
    cropped = img.crop((left, top, right, bottom))
    side = max(cropped.width, cropped.height)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2), cropped)
    return square


def export_icon(img: Image.Image, size: int) -> None:
    out = img.resize((size, size), Image.Resampling.LANCZOS)
    path = ICONS / f"icon{size}.png"
    out.save(path, optimize=True)
    print(f"Wrote {path}")


if not SRC.is_file():
    raise SystemExit(f"Missing logo source: {SRC}")

source = Image.open(SRC).convert("RGBA")
mark = trim_mark(source)
mark.save(MARK, optimize=True)
print(f"Wrote {MARK} ({mark.width}x{mark.height})")

for dim in (16, 48, 128):
    export_icon(mark, dim)
