#!/usr/bin/env python3
"""Verify the frozen textbook stage before bundling; no downloads or input mutation."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

def package(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists() or source == output or source in output.parents or output in source.parents:
        raise ValueError('Use fresh disjoint output')
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
    for folder in ('books', '_assets'):
        if (source/folder).is_symlink() or any(p.is_symlink() for p in (source/folder).rglob('*')):
            raise ValueError('No symlinked content')
    output.mkdir(parents=True)
    for folder in ('books', '_assets'):
        shutil.copytree(source/folder, output/folder)
    shutil.copy2(source/'textbook-manifest.json', output/'textbook-manifest.json')

if __name__ == '__main__':
    package(sys.argv[1],sys.argv[2])
