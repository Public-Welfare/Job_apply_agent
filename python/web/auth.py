"""Single-user JWT authentication for the dashboard.

Credentials live in ``.env`` (AUTH_USERNAME / AUTH_PASSWORD). The password is
bcrypt-hashed once at startup and verified in constant time on login. A signed
JWT is issued on success and required (via ``require_auth``) on every API route.

``require_auth`` accepts the token from either the ``Authorization: Bearer``
header (used by fetch) OR a ``?token=`` query param (used by plain ``<a href>``
file downloads, which can't set headers).
"""

from __future__ import annotations

import time
from typing import Optional

import bcrypt
import jwt
from fastapi import Header, HTTPException, Query

from src.config import config

# Hash the configured password once at import time.
_PW_HASH = bcrypt.hashpw(config.AUTH_PASSWORD.encode("utf-8"), bcrypt.gensalt())


def verify_credentials(username: str, password: str) -> bool:
    user_ok = username == config.AUTH_USERNAME
    try:
        pass_ok = bcrypt.checkpw(password.encode("utf-8"), _PW_HASH)
    except ValueError:
        pass_ok = False
    return user_ok and pass_ok


def create_token(username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": username,
        "iat": now,
        "exp": now + config.JWT_EXPIRE_HOURS * 3600,
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256")


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e


def require_auth(
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
) -> str:
    """FastAPI dependency — returns the authenticated username or raises 401."""
    raw: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:].strip()
    elif token:
        raw = token
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return _decode(raw).get("sub", "")
