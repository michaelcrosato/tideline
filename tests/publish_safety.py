#!/usr/bin/env python3
"""Unit checks for the publication helper. All Git/GitHub calls are mocked."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publish',ROOT/'tools/publish.py')
pub=importlib.util.module_from_spec(spec);spec.loader.exec_module(pub)

class PublishSafety(unittest.TestCase):
    def scenario(self, *, login='michaelcrosato', visibility='absent', branches=None,
                 lookup_error=404, origin=None, staged=None, parent=False):
        calls=[]
        def api(path):
            calls.append(['api',path])
            if path=='user': return {'login':login,'id':123}
            if '/branches?' in path: return branches or []
            if '/commits/' in path: return {'sha':'test-commit'}
            return {'html_url':'https://github.com/'+pub.TARGET,'visibility':'public','private':False}
        def run(args,check=True):
            calls.append(args)
            code=0;out='';err=''
            if args[:2]==['gh','api']:
                if visibility=='absent': code=1;err=f'HTTP {lookup_error}';out=''
                else: out=json.dumps({'private':visibility!='public','visibility':visibility})
            elif args[:3]==['git','rev-parse','--show-toplevel']:
                if parent:out=str(pub.ROOT.parent)
                else:code=128
            elif args[:3]==['git','symbolic-ref','--short']:out='main\n'
            elif args[:3]==['git','remote','get-url']:
                if origin:out=origin
                else:code=2
            elif args[:3]==['git','rev-list','--count']:code=128
            elif args[:4]==['git','diff','--cached','--name-only']:out='\n'.join(staged or ['README.md','index.html'])
            return subprocess.CompletedProcess(args,code,out,err)
        with tempfile.TemporaryDirectory() as d,patch.object(pub,'ROOT',Path(d)),patch.object(pub,'api',api),patch.object(pub,'run',run),patch.object(pub.shutil,'which',return_value='/test/tool'),patch('builtins.print'):
            try: pub.main();return calls,None
            except RuntimeError as e:return calls,str(e)

    def no_publish(self,calls):
        self.assertFalse(any(c[:3]==['gh','repo','create'] for c in calls))
        self.assertFalse(any('push' in c for c in calls))
    def test_wrong_account(self):
        calls,error=self.scenario(login='someone-else');self.assertIsNotNone(error);self.no_publish(calls)
    def test_private_target(self):
        calls,error=self.scenario(visibility='private');self.assertIsNotNone(error);self.no_publish(calls)
    def test_existing_work(self):
        calls,error=self.scenario(visibility='public',branches=[{'name':'main'}]);self.assertIsNotNone(error);self.no_publish(calls)
    def test_access_error_is_not_absence(self):
        calls,error=self.scenario(lookup_error=403);self.assertIsNotNone(error);self.no_publish(calls)
    def test_unrelated_origin(self):
        calls,error=self.scenario(origin='https://github.com/other/project.git');self.assertIsNotNone(error);self.no_publish(calls)
    def test_parent_repository(self):
        calls,error=self.scenario(parent=True);self.assertIsNotNone(error);self.no_publish(calls)
    def test_unrelated_staged_file(self):
        calls,error=self.scenario(staged=['index.html','private-notes.txt']);self.assertIsNotNone(error);self.no_publish(calls)
    def test_new_public_target(self):
        calls,error=self.scenario();self.assertIsNone(error)
        create=next(c for c in calls if c[:3]==['gh','repo','create'])
        self.assertIn('--public',create);self.assertIn(pub.TARGET,create)
        push=next(c for c in calls if c[0]=='git' and 'push' in c)
        self.assertNotIn('--force',push)
    def test_empty_public_target(self):
        calls,error=self.scenario(visibility='public');self.assertIsNone(error)
        self.assertFalse(any(c[:3]==['gh','repo','create'] for c in calls))
        self.assertTrue(any('push' in c for c in calls))

if __name__=='__main__':unittest.main(verbosity=2)
