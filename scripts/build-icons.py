"""
**사이트 아이콘 파일을 만든다** — 녹색 네모에 흰 '안' 한 글자 (사용자가 정했다 · 제목의 '안전운전' 딱지와 같은 녹색).

    npm run icons      # = python3 scripts/build-icons.py → public/favicon.ico · favicon.svg · favicon-96x96.png · apple-touch-icon.png

## 왜 파일인가

한동안 아이콘을 SVG 글자로 HTML 안에 심었다(data URI). 브라우저 탭에는 잘 떴지만, **구글 · 네이버 검색 결과에는 우리 아이콘
대신 회색 지구본이 떴다** (사용자가 짚었다, 2026-10-18). 검색엔진은 아이콘을 따로 내려받아 저장해 두고 쓰는데, 주소가 없는
data URI 는 내려받을 수 없고 `/favicon.ico` 는 404 였다. 구글은 48px 의 배수인 정사각형을, 네이버는 `/favicon.ico` 나
`<link rel="icon">` 이 가리키는 파일을 읽는다.

## 왜 글자를 외곽선으로 굳히는가

SVG 의 `<text>` 는 그 기기의 글꼴로 그려진다. 한글 글꼴이 없는 곳(검색엔진의 그림 서버 등)에서는 '안' 이 네모 칸으로
깨진다. 그래서 Noto Sans CJK KR Black 의 '안' 외곽선을 그대로 path 로 옮기고, PNG · ICO 도 같은 글꼴 · 같은 자리로 그린다.

결과 파일은 저장소에 커밋한다 — 배포 서버에는 이 글꼴도 이 도구(Pillow · fontTools)도 없다.
"""

from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTCollection
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"
FONT = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc")
GREEN = "#117332"
CHAR = "안"
# 64 칸 판 기준 — brand.ts 의 APP_ICON_SVG 와 같은 그림 (둥근 모서리 14, 글자 크기 44)
BOX = 64
RADIUS = 14
FONT_SIZE = 44
# 글자 먹(ink)의 가운데를 둘 자리 — 한가운데보다 반 칸 아래가 눈에 가운데로 보인다
CENTER = (32.0, 32.5)


def korean_face() -> int:
    """TTC 안에서 한국어 글꼴(KR)의 번호"""
    for i, font in enumerate(TTCollection(str(FONT)).fonts):
        name = font["name"].getDebugName(1) or ""
        if "KR" in name:
            return i
    raise SystemExit("Noto Sans CJK KR 을 찾지 못했다")


def svg_icon(face: int) -> str:
    font = TTCollection(str(FONT)).fonts[face]
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[ord(CHAR)]
    upm = font["head"].unitsPerEm
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    x0, y0, x1, y1 = bounds.bounds
    s = FONT_SIZE / upm
    # 글꼴 좌표(위가 +y)를 판 좌표(아래가 +y)로 — 먹의 가운데를 CENTER 에 둔다
    tx = CENTER[0] - (x0 + x1) / 2 * s
    ty = CENTER[1] + (y0 + y1) / 2 * s
    path = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    glyphs[name].draw(TransformPen(path, (s, 0, 0, -s, tx, ty)))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BOX} {BOX}">'
        f"<title>{CHAR}</title>"
        f'<rect width="{BOX}" height="{BOX}" rx="{RADIUS}" fill="{GREEN}"/>'
        f'<path fill="#ffffff" d="{path.getCommands()}"/>'
        "</svg>\n"
    )


def raster(face: int, size: int) -> Image.Image:
    """크게(8배) 그려 줄인다 — 작은 크기에서도 가장자리가 매끈하다"""
    big = size * 8
    k = big / BOX
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=RADIUS * k, fill=GREEN)
    font = ImageFont.truetype(str(FONT), round(FONT_SIZE * k), index=face)
    x0, y0, x1, y1 = draw.textbbox((0, 0), CHAR, font=font)
    draw.text((CENTER[0] * k - (x0 + x1) / 2, CENTER[1] * k - (y0 + y1) / 2), CHAR, font=font, fill="#ffffff")
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    face = korean_face()
    (OUT / "favicon.svg").write_text(svg_icon(face), encoding="utf-8")
    raster(face, 96).save(OUT / "favicon-96x96.png", optimize=True)
    # 아이폰 홈 화면 — 투명하면 검게 채워지므로 꽉 찬 네모(모서리는 기기가 깎는다)
    touch = Image.new("RGBA", (180, 180), GREEN)
    touch.alpha_composite(raster(face, 180))
    touch.convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    raster(face, 256).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for f in ("favicon.svg", "favicon-96x96.png", "apple-touch-icon.png", "favicon.ico"):
        print(f"  public/{f}  {(OUT / f).stat().st_size:,} B")


if __name__ == "__main__":
    main()
