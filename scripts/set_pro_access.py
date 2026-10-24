"""Grant or revoke Pro using an authenticated administrator, never a client flag."""
import argparse
from datetime import datetime, UTC
import hashlib
import json

import firebase_admin
from firebase_admin import auth, credentials
from google.cloud import firestore
from google.oauth2.credentials import Credentials
from cloud_support import ACCOUNT, PROJECT, access_token


class AdministratorCredential(credentials.Base):
    def __init__(self, token):
        self.credential = Credentials(token=token, quota_project_id=PROJECT)

    def get_credential(self):
        return self.credential


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email', required=True)
    parser.add_argument('--plan', choices=['free', 'pro'], required=True)
    args = parser.parse_args()
    credential = AdministratorCredential(access_token())
    app = firebase_admin.initialize_app(credential, options={'projectId': PROJECT}, name='admin-plan-access')
    user = auth.get_user_by_email(args.email, app=app)
    if user.disabled or not user.email_verified or not any(p.provider_id == 'google.com' for p in user.provider_data):
        raise RuntimeError('A verified, enabled Google account is required')
    client = firestore.Client(project=PROJECT, credentials=credential.get_credential())
    key = hashlib.sha256(user.uid.encode()).hexdigest()
    client.collection('translationEntitlements').document(key).set({
        'plan': args.plan, 'updatedAt': datetime.now(UTC), 'updatedBy': ACCOUNT,
        'expiresAt': None,
    })
    client.close()
    print(json.dumps({'email': user.email, 'plan': args.plan, 'permanent': args.plan == 'pro'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'success': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
