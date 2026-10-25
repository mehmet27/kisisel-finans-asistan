"""Create Google Play graphics from the checked-in application icon."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "store"
OUT.mkdir(parents=True, exist_ok=True)

icon = Image.open(ROOT / "assets" / "icon.png").convert("RGBA")
icon.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "play-icon.png")

canvas = Image.new("RGB", (1024, 500), "#123F50")
draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((34, 34, 990, 466), radius=42, fill="#174C5D")
small_icon = icon.resize((300, 300), Image.Resampling.LANCZOS)
canvas.paste(small_icon, (664, 100), small_icon)

font_candidates = [
    Path("/System/Library/Fonts/Avenir Next.ttc"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("C:/Windows/Fonts/arialbd.ttf"),
]
font_path = next((str(path) for path in font_candidates if path.exists()), "DejaVuSans.ttf")
title_font = ImageFont.truetype(font_path, 59)
body_font = ImageFont.truetype(font_path, 29)
draw.text((84, 142), "Kişisel Finans", font=title_font, fill="#FFFFFF")
draw.text((84, 216), "Asistanı", font=title_font, fill="#FFFFFF")
draw.text((86, 320), "Bütçen ve birikimin, bir arada.", font=body_font, fill="#8CE0CB")
canvas.save(OUT / "feature-graphic.png")
