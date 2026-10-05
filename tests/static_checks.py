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
check('Both startup identity and runtime build are retained',"TL-SURFACE-20261005.1" in html and 'const BUILD=BOOT.config.build' in html)
if shutil.which('node'):
    for name in ['bootkit.js','engine.js','surface.js','launch.js']:
        result=subprocess.run(['node','--check',str(ROOT/'src'/name)],capture_output=True,text=True)
        check('JavaScript syntax: '+name,result.returncode==0)
print(json.dumps({'passed':sum(c['passed'] for c in checks),'total':len(checks)}))
raise SystemExit(0 if all(c['passed'] for c in checks) else 1)
