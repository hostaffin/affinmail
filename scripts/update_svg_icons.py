import base64
import os

pub_dir = r"d:/AffinMail/webmail/public"
png_path = os.path.join(pub_dir, "logo-128.png")

with open(png_path, "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <clipPath id="squircleClip">
    <rect x="0" y="0" width="128" height="128" rx="28" />
  </clipPath>
  <image href="data:image/png;base64,{b64}" width="128" height="128" clip-path="url(#squircleClip)" />
</svg>'''

with open(os.path.join(pub_dir, "favicon.svg"), "w", encoding="utf-8") as f:
    f.write(svg_content)

with open(os.path.join(pub_dir, "logo-mark.svg"), "w", encoding="utf-8") as f:
    f.write(svg_content)

print("Updated favicon.svg and logo-mark.svg with the new logo!")
