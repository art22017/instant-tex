from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
out = root / 'assets'
out.mkdir(exist_ok=True)
image = Image.new('RGBA', (512, 512))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((10, 10, 502, 502), radius=118, fill='#24735c')
font = ImageFont.truetype('C:/Windows/Fonts/cambria.ttc', 380)
draw.text((256, 240), 'Σ', font=font, anchor='mm', fill='#f5faf4', stroke_width=1)
image.save(out / 'icon.png')
image.save(out / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
