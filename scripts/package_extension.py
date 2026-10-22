"""Package the built extension only, rejecting credentials and source maps."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
source = ROOT/'extension/dist'
manifest = json.loads((source/'manifest.json').read_text())
oauth_ready = bool(manifest.get('oauth2',{}).get('client_id'))
suffix = '' if oauth_ready else '-draft'
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
