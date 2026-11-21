"""Write artifact.html: index.html without the document wrapper (claude.ai adds its own), without the
YouTube player (artifact pages can't embed YouTube), and with the tab link pointing at the tab artifact."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / "index.html").read_text(encoding="utf-8")
for pat in [r'<!doctype html>\s*', r'<html[^>]*>\s*', r'<head>\s*', r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*',
            r'</head>\s*', r'<body>\s*', r'</body>\s*', r'</html>\s*', r'<script src="js/yt.js"></script>\s*']:
    s = re.sub(pat, '', s, count=1, flags=re.I)
s = s.replace('<a id="tabslink" class="linkbtn" href="tabs.html">Tab view</a>',
              '<a id="tabslink" class="linkbtn" href="https://claude.ai/artifact/Nt112kzemAj4qWHcohEyWi" target="_blank" rel="noopener">Tab view ↗</a>')
(root / "artifact.html").write_text(s, encoding="utf-8")
print("artifact.html written")
