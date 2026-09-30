"""Subset EB Garamond (SIL OFL) to Latin and write src/fonts.css with base64 WOFF2.
Usage: python3 tools/make_fonts.py"""
import base64, io, pathlib
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path('/usr/share/fonts/truetype/ebgaramond')
FACES = [('EBGaramond12-Regular.ttf', 'normal', 400), ('EBGaramond12-Italic.ttf', 'italic', 400), ('EBGaramond12-Bold.ttf', 'normal', 700)]
TEXT = ''.join(chr(c) for c in range(0x20, 0x7f)) + '\u2014\u2013\u2018\u2019\u201c\u201d\u2026\u00b7\u00d7\u2190\u2192\u00e9\u00a0'
css = ['/* EB Garamond by Georg Duffner and Octavio Pardo, SIL Open Font License 1.1 */']
for fn, style, weight in FACES:
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['kern', 'liga', 'onum', 'lnum']
    f = TTFont(SRC / fn)
    s = subset.Subsetter(opts); s.populate(text=TEXT); s.subset(f)
    buf = io.BytesIO(); f.flavor = 'woff2'; f.save(buf)
    b64 = base64.b64encode(buf.getvalue()).decode()
    css.append("@font-face{font-family:'EB Garamond';font-style:%s;font-weight:%d;font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2')}" % (style, weight, b64))
    print(fn, len(buf.getvalue()))
(ROOT / 'src/fonts.css').write_text('\n'.join(css) + '\n')
