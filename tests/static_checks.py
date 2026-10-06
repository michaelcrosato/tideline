#!/usr/bin/env python3
"""Dependency-free build and source checks. Does not start the game."""
from pathlib import Path
import importlib.util
import json
import re
import subprocess
import shutil

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('build', ROOT/'tools/build.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
html=(ROOT/'index.html').read_text(encoding='utf-8')
checks=[]
def check(name, passed):
    checks.append({'name':name,'passed':bool(passed)})
    print(('PASS ' if passed else 'FAIL ')+name)
check('Generated HTML equals editable source',html==module.build())
check('Build is deterministic',module.build()==module.build())
check('Game payload is deferred text',all(f'type="text/plain" id="{key}"' in html for key in ['game-style','game-ui','game-code']))
check('No remote script or style dependencies',not re.search(r'<(?:script|link)\b[^>]*(?:src|href)=["\'](?:https?:)?//',html,re.I))
check('No unresolved source markers','@@SURFACE_MODULE@@' not in html and '@@engine.js@@' not in html)
check('No literal credential or local working path',not re.search(r'github_pat_[A-Za-z0-9_]{25,}|gh[pousr]_[A-Za-z0-9]{25,}|/mnt/data/|/home/oai/|C:\\Users\\',html))
check('Both startup identity and runtime build are retained',"TL-SURFACE-20261006.1" in html and 'const BUILD=BOOT.config.build' in html)
engine=(ROOT/'src/engine.js').read_text(encoding='utf-8')
shared=[re.search(r'const '+name+r'=`(.*?)`;',engine,re.S) for name in ['sharedGLSL','surfaceGLSL']]
plain=[t for m in shared if m for t in re.findall(r'\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)',m.group(1)) if not t.startswith('sampler')]
check('Shared shader values are declared only in the Frame block',all(shared) and '${FRAME.glsl}' in shared[0].group(1) and not plain)
if shutil.which('node'):
    for name in ['bootkit.js','engine.js','surface.js','launch.js']:
        result=subprocess.run(['node','--check',str(ROOT/'src'/name)],capture_output=True,text=True)
        check('JavaScript syntax: '+name,result.returncode==0)
print(json.dumps({'passed':sum(c['passed'] for c in checks),'total':len(checks)}))
raise SystemExit(0 if all(c['passed'] for c in checks) else 1)
