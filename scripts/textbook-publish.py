#!/usr/bin/env python3
"""Publish the frozen Social Psychology HTML for native NB; never mutate the input."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit

BOOK = 'social_psychology'
PREFIX = '/books/'

def publish(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists():
        raise FileExistsError('Output must be new; preserve existing publications.')
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('Input and output must be disjoint.')
    book = source / BOOK
    if not book.is_dir():
        raise ValueError('Social Psychology collection missing.')
    pages = sorted(book.rglob('index.html'))
    if not pages:
        raise ValueError('No textbook pages.')
    inventory = []
    destinations = sorted([(page.relative_to(book).as_posix().removesuffix('/index.html'), '/books/' + page.relative_to(source).as_posix().removesuffix('index.html')) for page in pages if page.parent != book], key=lambda pair: len(pair[0]), reverse=True)
    def book_link(match):
        original = html.unescape(match.group(2))
        decoded = unquote(unquote(original)).rstrip('/')
        if original.startswith(('https://dev.libretexts.org/', 'https://library.libretexts.dev/')):
            for suffix,target in destinations:
                if decoded.endswith('/'+suffix):
                    return match.group(1)+html.escape(target,quote=True)+match.group(3)
        return match.group(0)
    # Validate inputs before writing. Do not follow source symlinks to other checkouts/state.
    if book.is_symlink() or any(p.is_symlink() for p in book.rglob('*')):
        raise ValueError('Symlinked collection is not a frozen input.')
    output.mkdir(parents=True)
    for page in pages:
        original = page.read_bytes()
        text = original.decode('utf-8')
        # Remove the legacy widget and its metadata only; retain Reader/Listen and content DOM.
        text = re.sub(r'<script\b(?=[^>]*\bid=["\']sr-page-context["\'])[^>]*>.*?</script>', '', text, flags=re.S)
        text = re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']*/annotations\.mjs["\'][^>]*>\s*</script>', '', text)
        text = re.sub(r'<link\b[^>]*\bhref=["\'][^"\']*/annotations\.css["\'][^>]*>', '', text)
        def local_anchor(match):
            original_tag=match.group(0)
            rewritten=re.sub(r'(href=["\'])(.*?)(["\'])', book_link, original_tag)
            if rewritten!=original_tag:
                rewritten=re.sub(r'\s+target=["\']_blank["\']','',rewritten)
            return rewritten
        text = re.sub(r'<a\b[^>]*>', local_anchor, text)
        # Only navigation attributes change. Content text and image/math markup stay byte-exact.
        text = re.sub(r'(href=["\'])/social_psychology(?=/|["\'])', r'\1/books/social_psychology', text)
        text = re.sub(r'(href=["\'])/(\s*["\'])', r'\1/books/social_psychology/\2', text)
        if text.count('</body>') != 1:
            raise ValueError('Expected one HTML body: '+str(page.relative_to(source)))
        canonical = '/books/' + page.relative_to(source).as_posix().removesuffix('index.html')
        text = re.sub(r'<html\b', '<html data-nb-textbook data-nb-source-path="' + html.escape(canonical, quote=True) + '"', text, count=1)
        text = text.replace('</head>', '<link rel="stylesheet" href="/_assets/nb-book/book.css"></head>')
        text = text.replace('</body>', '<script src="/client/js/bundle.js"></script><script src="/_assets/nb-book/book.js"></script></body>')
        target = output / 'books' / page.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        title = re.search(r'<title>(.*?)</title>', text, re.S)
        inventory.append({'path': '/books/' + page.relative_to(source).as_posix().removesuffix('index.html'), 'title': title.group(1) if title else '', 'inputSha256': hashlib.sha256(original).hexdigest(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    shutil.copytree(Path(__file__).resolve().parents[1] / 'deploy/nb-demo/book', output / '_assets/nb-book')
    (output / 'textbook-manifest.json').write_text(json.dumps({'book': BOOK, 'pages': inventory}, indent=2)+'\n')
    return inventory

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source'); p.add_argument('output')
    args = p.parse_args()
    print(json.dumps({'pages':len(publish(args.source, args.output))}))
