import importlib.util
import pathlib
import tempfile
import unittest
import subprocess
import sys

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/textbook-publish.py'

class Publication(unittest.TestCase):
    def test_native_book_preserves_content_and_navigation_without_legacy_client(self):
        spec = importlib.util.spec_from_file_location('publisher', SCRIPT)
        publisher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(publisher)
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            source = root / 'source'
            page = source / 'social_psychology' / '13.01' / 'index.html'
            page.parent.mkdir(parents=True)
            content = '<main id="main-content"><h1>Cooperation</h1><p>Exact <em>meaning</em> with \\(x^2\\).</p><img src="/_assets/figure.png" alt="figure"></main>'
            page.write_text('<html><head><title>Book</title></head><body><a href="/social_psychology/13.02/">Next</a><a target="_blank" href="https://dev.libretexts.org/https%3A%2F%2Fsocialsci.libretexts.org/Bookshelves/Example/social_psychology/13.02">Chapter</a>'+content+'<script id="sr-page-context" type="application/json">{}</script><script type="module" src="/_assets/reader/annotations.mjs"></script></body></html>')
            second = source / 'social_psychology' / '13.02' / 'index.html'
            second.parent.mkdir(parents=True)
            second.write_text('<html><head><title>Next</title></head><body><main id="main-content"><p>Next page</p></main></body></html>')
            output = root / 'output'
            publisher.publish(source, output)
            rendered = (output / 'books/social_psychology/13.01/index.html').read_text()
            self.assertIn(content, rendered)
            self.assertIn('href="/books/social_psychology/13.02/"', rendered)
            self.assertIn('src="/client/js/bundle.js"', rendered)
            self.assertNotIn('https://dev.libretexts.org/', rendered)
            self.assertNotIn('target="_blank"',rendered)
            self.assertNotIn('sr-page-context', rendered)
            self.assertNotIn('annotations.mjs', rendered)
            with self.assertRaises(FileExistsError):
                publisher.publish(source, output)
            package = SCRIPT.with_name('textbook-package.py')
            result = subprocess.run([sys.executable, str(package), str(output), str(root/'release')], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            (output/'books/social_psychology/13.01/index.html').write_text('changed reading')
            result = subprocess.run([sys.executable, str(package), str(output), str(root/'damaged')], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root/'damaged').exists())

if __name__ == '__main__': unittest.main()
