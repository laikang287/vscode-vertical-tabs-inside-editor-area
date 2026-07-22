import sys
sys.stdout.reconfigure(encoding="utf-8")

nav = """<p align="center">
  <a href="README.md">English</a> \u00b7
  <a href="README.zh-CN.md">\u7b80\u4f53\u4e2d\u6587\uff08\u89c4\u8303\u6e90\uff09</a> \u00b7
  <a href="docs/README.zh-TW.md">\u7e41\u9ad4\u4e2d\u6587</a> \u00b7
  <a href="docs/README.ja.md">\u65e5\u672c\u8a9e</a> \u00b7
  <a href="docs/README.ko.md">\ud55c\uad6d\uc5b4</a> \u00b7
  <a href="docs/README.es.md">Espa\u00f1ol</a> \u00b7
  <a href="docs/README.fr.md">Fran\u00e7ais</a> \u00b7
  <a href="docs/README.de.md">Deutsch</a> \u00b7
  <a href="docs/README.ru.md">\u0420\u0443\u0441\u0441\u043a\u0438\u0439</a>
</p>"""

print("nav ok, len:", len(nav))
