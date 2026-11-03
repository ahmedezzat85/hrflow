"""
Helpers for tests that sign in through the Google OAuth redirect flow with Google's side faked.
"""
from urllib.parse import parse_qs, urlparse


def fake_google(monkeypatch, id_payload, refresh_token="refresh-token-1", id_token="fake-id-token"):
    """Replaces Google's token endpoint and ID-token check. `id_payload` is the verified ID token's claims
    (None = the ID-token check fails). Returns a dict that records the code exchanges."""
    import auth as auth_module
    import google_oauth

    calls = {"exchange": []}

    def exchange_code(code, redirect_uri, verifier):
        calls["exchange"].append({"code": code, "redirect_uri": redirect_uri, "verifier": verifier})
        tokens = {"id_token": id_token}
        if refresh_token is not None:
            tokens["refresh_token"] = refresh_token
        return tokens

    def verify(cred, req, aud):
        if id_payload is None:
            raise ValueError("bad token")
        return id_payload

    monkeypatch.setattr(google_oauth, "exchange_code", exchange_code)
    monkeypatch.setattr(auth_module.google_id_token, "verify_oauth2_token", verify)
    return calls


def google_sign_in(client, return_to="http://localhost:5173"):
    """Runs start -> (Google) -> callback on `client`. Returns the callback response (a redirect, not followed)."""
    start = client.get("/api/auth/google/start", params={"return_to": return_to}, follow_redirects=False)
    assert start.status_code == 302, start.text
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    return client.get("/api/auth/google/callback", params={"code": "one-time-code", "state": state}, follow_redirects=False)


def login_error(response):
    """The ?login_error= code a callback redirect carries, or None when the sign-in succeeded."""
    return parse_qs(urlparse(response.headers["location"]).query).get("login_error", [None])[0]
