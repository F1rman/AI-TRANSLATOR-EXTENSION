"""Bind the owner's Chrome OAuth client after the Store draft has a stable ID."""
import argparse
import re
from cloud_support import api, PROJECT


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-id', required=True)
    parser.add_argument('--extension-id', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-p]{32}', args.extension_id):
        parser.error('Extension ID must contain 32 lowercase letters a through p.')
    if not re.fullmatch(r'\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', args.client_id):
        parser.error('Supply the Chrome Extension OAuth client ID, not a secret.')
    base = f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}'
    provider = base+'/defaultSupportedIdpConfigs/google.com'
    try:
        api(provider)
    except RuntimeError as error:
        if '404' not in str(error):
            raise
        api(base+'/defaultSupportedIdpConfigs?idpId=google.com','POST',
            {'enabled':True,'clientId':args.client_id})
    else:
        api(provider+'?updateMask=enabled,clientId','PATCH',
            {'enabled':True,'clientId':args.client_id})
    config = api(base+'/config')
    domains = list(dict.fromkeys(config.get('authorizedDomains', []) + [f'chrome-extension://{args.extension_id}']))
    api(base+'/config?updateMask=authorizedDomains','PATCH',{'authorizedDomains':domains})
    print('Google provider and extension origin configured. Rebuild the extension with its OAuth client and Store public key.')
