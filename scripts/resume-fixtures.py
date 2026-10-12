"""Public, synthetic materials for resume acceptance; no personal credentials."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Pt
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
import zipfile

root=Path(__file__).resolve().parent.parent/'.test-data/resume-fixtures'
root.mkdir(parents=True,exist_ok=True)
project=root/'中文 Agent 项目';project.mkdir(exist_ok=True)
readme='''# 资料检索 Agent 演示项目
测试材料，不代表实际商业项目。项目实现 Python 关键词检索接口与检索结果状态包装，不含外部工具执行。
本人负责检索函数、结果包装与单元测试。工具调用编排仅为设计思路，未测量准确率或性能增益。
项目时间：2026年6月至2026年8月。未包含个人密钥。
'''
(project/'README.md').write_text(readme,encoding='utf-8')
(project/'agent.py').write_text('''def retrieve(query, documents):
    return [doc for doc in documents if query in doc]

def agent(question, documents):
    evidence = retrieve(question, documents)
    return {"evidence": evidence, "status": "found" if evidence else "not_found"}
''',encoding='utf-8')
(project/'test_agent.py').write_text('from agent import agent\nassert agent("检索", ["检索系统"]) ["status"] == "found"\nassert agent("不存在", ["检索系统"]) ["status"] == "not_found"\n',encoding='utf-8')
(project/'.env').write_text('API_KEY=not-a-real-key-private-fixture',encoding='utf-8')
with zipfile.ZipFile(root/'源码.zip','w') as z:
    for p in project.iterdir():z.write(p,p.name)
with zipfile.ZipFile(root/'路径逃逸.zip','w') as z:z.writestr('../escape.py','bad')
fontpath='C:/Windows/Fonts/msyh.ttc'
pdfmetrics.registerFont(TTFont('MicrosoftYaHei',fontpath,subfontIndex=0))
paper=['检索与工具调用流程设计 研究记录','测试论文材料：未投稿、未录用、未发表。',
       '研究内容：将文档检索结果作为工具输入，组织智能体回答流程。',
       '方法：拆分检索与工具路由，通过单元测试覆盖无结果情况。',
       '本文未开展性能评测，不能据此认定准确率或增益。',
       '个人参与：测试作者负责检索函数与测试；作者身份需用户确认。']
c=canvas.Canvas(str(root/'研究记录.pdf'));c.setFont('MicrosoftYaHei',12)
for i,line in enumerate(paper):c.drawString(42,790-i*35,line)
c.save()
d=Document();d.styles['Normal'].font.name='Microsoft YaHei';d.styles['Normal'].font.size=Pt(11)
for line in paper:d.add_paragraph(line)
d.save(root/'科研说明.docx')
img=Image.new('RGB',(1000,1400),'white');draw=ImageDraw.Draw(img);font=ImageFont.truetype(fontpath,24)
for i,line in enumerate(paper):draw.text((45,90+i*80),line,font=font,fill='#222222')
img.save(root/'扫描材料.png');c=canvas.Canvas(str(root/'扫描材料.pdf'));c.drawImage(ImageReader(img),0,0,width=595,height=842);c.save()
template=Image.new('RGB',(900,1250),'white');draw=ImageDraw.Draw(template)
for y,text in [(60,'姓名  联系方式'),(190,'教育背景'),(380,'科研成果'),(650,'项目经历'),(930,'专业技能')]:
    draw.text((50,y),text,font=ImageFont.truetype(fontpath,28),fill='#315b49');draw.line((50,y+50,850,y+50),fill='#d5ded5',width=2)
template.save(root/'科研模板.png')
photo=Image.new('RGB',(240,320),'#e1e7e0');ImageDraw.Draw(photo).ellipse((75,50,165,140),fill='#8eab98');photo.save(root/'测试照片.png')
print(root)
