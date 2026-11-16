#!/usr/bin/env python3
"""Run the supported Reader manifest builder read-only against a new NB-owned stage."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

def build(reader,stage):
    reader,stage=Path(reader).resolve(),Path(stage).resolve()
    if reader==stage or reader in stage.parents or stage in reader.parents:raise ValueError('Use disjoint owned stage')
    subprocess.run(['git','-C',str(reader),'diff','--exit-code','HEAD','--','pipeline'],check=True,stdout=subprocess.DEVNULL)
    pin=subprocess.check_output(['git','-C',str(reader),'rev-parse','HEAD'],text=True).strip()
    sys.dont_write_bytecode=True
    sys.path.insert(0,str(reader))
    from pipeline.tts_manifest import build_manifest
    from pipeline.tokenize import SENTENCE_SPLIT_VERSION
    report=[]
    for page in sorted((stage/'books/social_psychology').rglob('index.html')):
        html=page.read_text()
        manifest=build_manifest(html,page_id=str(page.parent.relative_to(stage)),title=page.parent.name)
        if manifest['stats']['sentences']:
            expected=hashlib.sha256(f'v{SENTENCE_SPLIT_VERSION}\0'.encode()+html.encode()).hexdigest()
            if manifest['generatedFrom']!=expected:raise ValueError('Unsupported manifest identity')
            target=page.with_name('speech.json')
            if target.exists() and json.loads(target.read_text())['generatedFrom']!=expected:raise ValueError('Preserve incompatible speech manifest')
            target.write_text(json.dumps(manifest,ensure_ascii=False)+'\n')
            report.append({'page':str(page.relative_to(stage)),'generatedFrom':expected,'blocks':manifest['stats']['blocks'],'sentences':manifest['stats']['sentences']})
    (stage/'speech-provenance.json').write_text(json.dumps({'publisher':pin,'splitter':SENTENCE_SPLIT_VERSION,'pages':report},indent=2)+'\n')
    return len(report)
if __name__=='__main__':print(json.dumps({'speechPages':build(sys.argv[1],sys.argv[2])}))
