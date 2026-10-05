#!/usr/bin/env python3
"""Initial public publication, limited to michaelcrosato/tideline.
Requires Git and an authenticated GitHub CLI. Never reads or prints a token.
Refuses private or nonempty remote repositories. No force push or visibility change.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'michaelcrosato/tideline'
OWNER = 'michaelcrosato'
URL = 'https://github.com/' + TARGET + '.git'
FILES = ('README.md', 'CHANGELOG.md', '.gitignore', 'index.html',
         'src', 'tools', 'tests', 'docs', '.github', 'MANIFEST.sha256',
         'package.json', 'package-lock.json', 'vercel.json', '.vercelignore', '.nvmrc',
         '.gitattributes')


def run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or str(args))
    return result


def api(path: str) -> dict | list:
    return json.loads(run(['gh', 'api', path]).stdout)


def main() -> None:
    for name in ('git', 'gh'):
        if not shutil.which(name):
            raise RuntimeError(f'Install {name} before publishing. See docs/publishing.md.')
    run([sys.executable, 'tools/build.py', '--check'])
    profile = api('user')
    if profile.get('login', '').lower() != OWNER:
        raise RuntimeError(f'Authenticate GitHub CLI as {OWNER}. No repository was changed.')
    lookup = run(['gh', 'api', 'repos/' + TARGET], check=False)
    exists = lookup.returncode == 0
    if exists:
        remote = json.loads(lookup.stdout)
        if remote.get('private') or remote.get('visibility') != 'public':
            raise RuntimeError('The target exists but is not public. Its visibility was not changed.')
        # A README or any branch means there is existing work to review first.
        branches = api('repos/' + TARGET + '/branches?per_page=1')
        if branches:
            raise RuntimeError('The target is not empty. Review it before publishing. No overwrite was attempted.')
    elif '404' not in lookup.stderr and 'Not Found' not in lookup.stdout:
        raise RuntimeError(lookup.stderr.strip() or 'Repository lookup failed; not treated as an empty repository.')

    local = run(['git', 'rev-parse', '--show-toplevel'], check=False)
    if local.returncode == 0 and Path(local.stdout.strip()).resolve() != ROOT:
        raise RuntimeError('Extract this source package outside another Git repository.')
    if not (ROOT / '.git').exists():
        run(['git', 'init', '-b', 'main'])
    branch = run(['git', 'symbolic-ref', '--short', 'HEAD']).stdout.strip()
    if branch != 'main':
        raise RuntimeError('The local branch must be main. No branch was renamed.')
    origin = run(['git', 'remote', 'get-url', 'origin'], check=False)
    if origin.returncode == 0 and origin.stdout.strip() not in (URL, URL[:-4], 'git@github.com:'+TARGET+'.git'):
        raise RuntimeError('The local origin points to another repository. It was not changed.')
    # The helper is for an initial publication, not for rewriting an existing history.
    history = run(['git', 'rev-list', '--count', 'HEAD'], check=False)
    if history.returncode == 0 and int(history.stdout.strip()) > 1:
        raise RuntimeError('This local repository has an existing history. Publish it manually after review.')
    run(['git', 'add', '--', *FILES])
    staged = run(['git', 'diff', '--cached', '--name-only']).stdout.splitlines()
    for path in staged:
        if path.split('/')[0] not in FILES:
            raise RuntimeError('An unrelated staged file was found. Review the staging area first.')
    if staged:
        name = OWNER
        email = f'{profile["id"]}+{OWNER}@users.noreply.github.com'
        run(['git', '-c', 'user.name='+name, '-c', 'user.email='+email,
             'commit', '-m', 'Add Tideline Surface: foam, wetness, filtered highlights and path wakes'])
    if not exists:
        run(['gh', 'repo', 'create', TARGET, '--public', '--description',
             'Offline water and light lab with mobile controls, towing and repeatable benchmarks'])
    if origin.returncode != 0:
        run(['git', 'remote', 'add', 'origin', URL])
    # GitHub CLI supplies credentials through its helper. No credentials enter a URL or file.
    run(['git', '-c', 'credential.helper=', '-c',
         'credential.https://github.com.helper=!gh auth git-credential',
         'push', '-u', 'origin', 'main'])
    verified = api('repos/' + TARGET)
    commit = api('repos/' + TARGET + '/commits/main')
    print('Published public repository: ' + verified['html_url'])
    print('Commit: ' + commit['sha'])


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError) as exc:
        print('Publication stopped: ' + str(exc), file=sys.stderr)
        raise SystemExit(1)
