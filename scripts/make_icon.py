from pathlib import Path
from PIL import Image, ImageDraw
# Code-drawn geometric pi mark, kept independent of system fonts.
root=Path(__file__).resolve().parents[1]
img=Image.new('RGBA',(512,512),(0,0,0,0));d=ImageDraw.Draw(img)
d.rounded_rectangle((8,8,504,504),radius=116,fill='#243e34')
d.rounded_rectangle((112,148,400,191),radius=18,fill='#f5f3e9')
d.polygon([(163,174),(210,174),(189,358),(143,358)],fill='#f5f3e9')
d.rounded_rectangle((302,173,345,362),radius=18,fill='#f5f3e9')
d.ellipse((377,343,402,368),fill='#bac9ac')
out=root/'resources';out.mkdir(exist_ok=True)
img.save(out/'icon.png')
img.save(out/'icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
