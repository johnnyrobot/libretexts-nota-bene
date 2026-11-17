#!/usr/bin/env python3
"""Verify the frozen textbook stage before bundling; no downloads or input mutation."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

def validate(source):
    source=Path(source).resolve()
    manifest = json.loads((source/'textbook-manifest.json').read_text())
    if manifest['book'] != 'social_psychology' or not manifest['pages']:
        raise ValueError('Unexpected book')
    paths = set()
    for page in manifest['pages']:
        uri = page['path']
        if not uri.startswith('/books/social_psychology/') or '..' in uri or not uri.endswith('/') or uri in paths:
            raise ValueError('Invalid or duplicate chapter')
        paths.add(uri)
        content = source / uri.lstrip('/') / 'index.html'
        if hashlib.sha256(content.read_bytes()).hexdigest() != page['sha256']:
            raise ValueError('Chapter digest mismatch')
    for speech in (source/'books').rglob('speech.json'):
        page=speech.with_name('index.html')
        data=json.loads(speech.read_text())
        expected=hashlib.sha256(b'v3\0'+page.read_bytes()).hexdigest()
        if data.get('generatedFrom')!=expected:
            raise ValueError('Speech manifest is incompatible with exact staged HTML')
    for folder in ('books', '_assets'):
        if (source/folder).is_symlink() or any(p.is_symlink() for p in (source/folder).rglob('*')):
            raise ValueError('No symlinked content')

def identity(source):
    source=Path(source).resolve()
    validate(source)
    files=[source/'textbook-manifest.json']
    if (source/'speech-provenance.json').exists():files.append(source/'speech-provenance.json')
    for folder in ('books','_assets'):files.extend(p for p in (source/folder).rglob('*') if p.is_file())
    digest=hashlib.sha256()
    for file in sorted(files,key=lambda p:p.relative_to(source).as_posix()):
        digest.update(file.relative_to(source).as_posix().encode('utf-8')+b'\0')
        digest.update(hashlib.file_digest(file.open('rb'),'sha256').digest())
    return digest.hexdigest()

def package(source,output):
    source,output=Path(source).resolve(),Path(output).resolve()
    if output.exists() or source==output or source in output.parents or output in source.parents:raise ValueError('Use fresh disjoint output')
    validate(source)
    output.mkdir(parents=True)
    for folder in ('books', '_assets'):
        shutil.copytree(source/folder, output/folder)
    shutil.copy2(source/'textbook-manifest.json', output/'textbook-manifest.json')
    if (source/'speech-provenance.json').exists():shutil.copy2(source/'speech-provenance.json',output/'speech-provenance.json')

if __name__=='__main__':
    if sys.argv[1]=='--identity':print(identity(sys.argv[2]))
    else:package(sys.argv[1],sys.argv[2])
