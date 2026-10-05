#!/usr/bin/env python3
"""Build the offline HTML from source files. No third-party package is needed."""
from pathlib import Path
import argparse
import re

ROOT = Path(__file__).resolve().parents[1]

def build() -> str:
    src = ROOT / 'src'
    shell = (src / 'shell.html').read_text(encoding='utf-8')
    def include(match: re.Match) -> str:
        name = match.group(1)
        content = (src / name).read_text(encoding='utf-8')
        if name == 'engine.js':
            content = content.replace('/* @@SURFACE_MODULE@@ */', (src / 'surface.js').read_text(encoding='utf-8'))
        if re.search(r'</script\s*>', content, re.I):
            raise ValueError(f'{name} contains a closing script tag')
        return content.rstrip('\n')
    return re.sub(r'@@([a-z.-]+)@@', include, shell)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = build()
    output = ROOT / 'index.html'
    if args.check:
        if not output.exists() or output.read_text(encoding='utf-8') != result:
            raise SystemExit('index.html does not match source; run python tools/build.py')
        print('Build matches source.')
    else:
        output.write_text(result, encoding='utf-8')
        print(f'Built index.html: {len(result.encode("utf-8")):,} bytes')
