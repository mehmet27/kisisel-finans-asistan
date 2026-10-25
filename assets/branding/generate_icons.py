"""Generate Expo icon assets from the Aylar logo geometry (requires Pillow)."""

from pathlib import Path

from PIL import Image, ImageDraw


ASSETS = Path(__file__).resolve().parents[1]
BRANDING = ASSETS / "branding"
SCALE = 4
NAVY = "#123F50"
MINT = "#77D7B9"
WHITE = "#F7FBFA"
BLUE = "#145B73"


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(tuple(value * SCALE for value in box), radius * SCALE, fill=fill)


def calendar(size, monochrome=False):
    canvas = Image.new("RGBA", (1024 * SCALE, 1024 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    rounded(draw, (188, 248, 836, 794), 106, WHITE)
    if monochrome:
        for left, top, right in [(290, 536, 398), (458, 472, 566), (626, 512, 734)]:
            rounded(draw, (left, top, right, 710), 43, (0, 0, 0, 0))
    else:
        rounded(draw, (188, 248, 836, 406), 106, MINT)
        draw.rectangle((188 * SCALE, 350 * SCALE, 836 * SCALE, 406 * SCALE), fill=MINT)
        for left, top, right in [(290, 536, 398), (458, 472, 566), (626, 512, 734)]:
            rounded(draw, (left, top, right, 710), 43, BLUE)
    # The calendar rings are cut out so the adaptive background remains visible.
    rounded(draw, (310, 198, 374, 336), 32, (0, 0, 0, 0))
    rounded(draw, (650, 198, 714, 336), 32, (0, 0, 0, 0))
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


Image.open(BRANDING / "concept-a.png").save(ASSETS / "icon.png")
calendar(512).save(ASSETS / "android-icon-foreground.png")
Image.new("RGB", (512, 512), NAVY).save(ASSETS / "android-icon-background.png")
calendar(432, monochrome=True).save(ASSETS / "android-icon-monochrome.png")
Image.open(BRANDING / "concept-a.png").resize((48, 48), Image.Resampling.LANCZOS).save(ASSETS / "favicon.png")
