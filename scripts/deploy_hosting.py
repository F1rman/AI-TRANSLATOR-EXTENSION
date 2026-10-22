"""Deploy only hosting/ through the Firebase Hosting REST API."""
import gzip
import hashlib
from pathlib import Path
import ssl
import urllib.request
from cloud_support import api, access_token, PROJECT


if __name__ == '__main__':
    token = access_token()
    base = 'https://firebasehosting.googleapis.com/v1beta1'
    try:
        api(f'{base}/projects/{PROJECT}/sites/{PROJECT}', token=token)
    except RuntimeError as error:
        if '404' not in str(error):
            raise
        api(f'{base}/projects/{PROJECT}/sites?siteId={PROJECT}', 'POST', {}, token=token)
    files = {}
    blobs = {}
    for path in Path('hosting').rglob('*'):
        if path.is_file() and not path.name.startswith('.'):
            blob = gzip.compress(path.read_bytes(), mtime=0)
            checksum = hashlib.sha256(blob).hexdigest()
            files['/'+path.relative_to('hosting').as_posix()] = checksum
            blobs[checksum] = blob
    import json
    config = json.loads(Path('firebase.json').read_text())['hosting']
    config = {key: config[key] for key in ['cleanUrls', 'headers']}
    # Hosting REST uses glob/map, whereas firebase.json uses source/key/value.
    config['headers'] = [{'glob': h['source'], 'headers': {v['key']: v['value'] for v in h['headers']}} for h in config['headers']]
    version = api(f'{base}/sites/{PROJECT}/versions', 'POST', {'config': config}, token=token)['name']
    populate = api(f'{base}/{version}:populateFiles', 'POST', {'files': files}, token=token)
    context = ssl.create_default_context(cafile='/etc/ssl/cert.pem')
    for checksum in populate.get('uploadRequiredHashes', []):
        request = urllib.request.Request(populate['uploadUrl']+'/'+checksum, data=blobs[checksum],
            headers={'Authorization':'Bearer '+token, 'Content-Type':'application/octet-stream'}, method='POST')
        with urllib.request.urlopen(request, context=context, timeout=60) as response:
            response.read()
    api(f'{base}/{version}?update_mask=status', 'PATCH', {'status':'FINALIZED'}, token=token)
    api(f'{base}/sites/{PROJECT}/releases?versionName={version}', 'POST', {}, token=token)
    print(f'Deployed {len(files)} files to https://{PROJECT}.web.app')
