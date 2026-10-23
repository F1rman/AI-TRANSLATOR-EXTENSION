"""Authorize the Store extension without replacing Firebase's Google web client."""
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
        google = api(provider)
    except RuntimeError as error:
        if '404' not in str(error):
            raise
        raise SystemExit('Enable Google in Firebase Authentication first; keep its Web application OAuth client. '
                         'The Chrome Extension OAuth client belongs in the extension manifest.') from None
    if not google.get('clientId'):
        raise SystemExit('Configure the Google provider Web application client in Firebase Authentication first.')
    # Firebase's provider client and chrome.identity's extension client have distinct roles.
    # Never overwrite the provider's existing clientId/clientSecret with a Chrome client.
    if not google.get('enabled'):
        api(provider+'?updateMask=enabled','PATCH',{'enabled':True})
    config = api(base+'/config')
    domains = list(dict.fromkeys(config.get('authorizedDomains', []) + [f'chrome-extension://{args.extension_id}']))
    if domains != config.get('authorizedDomains', []):
        api(base+'/config?updateMask=authorizedDomains','PATCH',{'authorizedDomains':domains})
    print('Google provider preserved; extension origin authorized. '
          'Set VITE_GOOGLE_CLIENT_ID to the Chrome Extension client and rebuild with the Store public key.')
