"""Package the built extension only, rejecting credentials and source maps."""
import json
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--environment', choices=['live', 'test'], default='live')
args = parser.parse_args()
source = ROOT / ('extension/dist-test' if args.environment == 'test' else 'extension/dist')
manifest = json.loads((source/'manifest.json').read_text())
metadata = json.loads((source/'billing-build.json').read_text())
target = json.loads((ROOT/'extension/billing-targets.json').read_text())[args.environment]
if (metadata.get('environment') != args.environment or metadata.get('version') != manifest['version']
        or any(metadata.get(key) != target[key] for key in ('apiBaseUrl', 'billingBaseUrl'))):
    raise SystemExit('Build metadata does not match the requested packaging environment')
import base64
digest = hashlib.sha256(base64.b64decode(manifest.get('key', ''), validate=True)).hexdigest()[:32]
identifier = ''.join(chr(97 + int(char, 16)) for char in digest)
if identifier != 'aieamemimbcbbnmakifejomadhegogge' or metadata.get('extensionId') != identifier:
    raise SystemExit('The extension ID must match the existing Chrome OAuth configuration')
oauth_ready = bool(manifest.get('oauth2',{}).get('client_id'))
if not oauth_ready:
    raise SystemExit('Chrome OAuth must be configured before packaging this release')
suffix = '-test' if args.environment == 'test' else ''
output = ROOT/'artifacts'/f"ai-translator-{manifest['version']}{suffix}.zip"
output.parent.mkdir(exist_ok=True)
files = [path for path in source.rglob('*') if path.is_file()]
for path in files:
    if path.name.startswith('.') or path.suffix in {'.pem','.key','.map'} or 'adminsdk' in path.name:
        raise SystemExit(f'Unexpected package file: {path.name}')
    if path.suffix in {'.js','.json','.html'}:
        text = path.read_text()
        if '-----BEGIN PRIVATE KEY-----' in text or 'API_ACCESS_TOKEN=' in text:
            raise SystemExit(f'Credential material detected in {path.name}')
with ZipFile(output,'w',ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path,path.relative_to(source).as_posix())
print(f'{output} ({output.stat().st_size:,} bytes; {len(files)} files)')
if not oauth_ready:
    print('Google OAuth configuration is pending. This ZIP can create the Store draft; rebuild after OAuth setup.')
