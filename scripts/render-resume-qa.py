"""Windows QA bridge: use installed Word for PDF conversion, skill renderer for PNGs.
The app itself requires neither Word nor Python. No managed skill file is edited.
"""
import argparse, importlib.util, os, subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
skill=Path(os.environ['RESUME_DOCUMENT_SKILL'])/'render_docx.py'
spec=importlib.util.spec_from_file_location('render_docx',skill);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('--out',required=True);a=p.parse_args()
def word_pdf(doc_path,user_profile,convert_tmp_dir,stem,verbose=False):
    target=str(Path(convert_tmp_dir)/(stem+'.pdf'))
    result=subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(root/'scripts/render-resume-word.ps1'),'-InputDoc',doc_path,'-OutputPdf',target],capture_output=True,text=True,timeout=120)
    if result.returncode:raise RuntimeError(result.stderr)
    return target,'Installed Microsoft Word conversion; bundled render_docx.py rasterization'
mod.convert_to_pdf=word_pdf
paths=mod.rasterize(a.input,a.out,130,verbose=True,emit_pdf=True)
print('\n'.join(paths))
