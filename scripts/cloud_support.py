"""Small deployment helpers. Credentials are captured in memory, never printed."""
from __future__ import annotations

import json
import ssl
import subprocess
import urllib.error
import urllib.request

PROJECT = "ai-translator-ext"
ACCOUNT = "balubenko.ink@gmail.com"
REGION = "europe-west1"


def gcloud(*args: str, json_output: bool = False):
    command = ["gcloud", *args, f"--account={ACCOUNT}", f"--project={PROJECT}", "--quiet"]
    if json_output:
        command.append("--format=json")
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout) if json_output and result.stdout.strip() else result.stdout.strip()


def access_token() -> str:
    return gcloud("auth", "print-access-token")


def api(url: str, method: str = "GET", data=None, *, token: str | None = None):
    body = None if data is None else json.dumps(data).encode()
    request = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": "Bearer " + (token or access_token()),
        "Content-Type": "application/json",
        "x-goog-user-project": PROJECT,
    })
    context = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    try:
        with urllib.request.urlopen(request, context=context, timeout=90) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        # Google errors contain no submitted request body; expose only structured error.
        try:
            detail = json.loads(error.read()).get("error", {})
            message = detail.get("message", "request rejected")
        except Exception:
            message = "request rejected"
        raise RuntimeError(f"{method} {url.split('?')[0]}: HTTP {error.code}: {message}") from None


if __name__ == "__main__":
    for label, url in [
        ("auth", f"https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config"),
        ("google", f"https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/defaultSupportedIdpConfigs/google.com"),
        ("apps", f"https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/webApps"),
    ]:
        try:
            result = api(url)
            if label == "auth":
                result = {key: result.get(key) for key in ("name", "authorizedDomains", "signIn", "client")}
            if label == "google":
                result = {key: value for key, value in result.items() if key != "clientSecret"}
            print(label, json.dumps(result))
        except RuntimeError as error:
            print(str(error))
