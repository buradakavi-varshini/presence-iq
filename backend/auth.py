import logging
import os
from datetime import datetime, timedelta, timezone

import jwt
import psycopg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, Field
from pwdlib import PasswordHash

from database import get_connection

SECRET_KEY = os.environ.get("JWT_SECRET_KEY")
if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise RuntimeError("Set JWT_SECRET_KEY in backend/.env.")

ALGORITHM = "HS256"
TOKEN_MINUTES = 30
ALLOWED_ROLES = {"admin", "teacher"}

router = APIRouter(prefix="/auth", tags=["Authentication"])
bearer = HTTPBearer(auto_error=False)
password_hasher = PasswordHash.recommended()
logger = logging.getLogger(__name__)
DUMMY_HASH = password_hasher.hash("unused-dummy-password")


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)


def find_user(*, email=None, user_id=None):
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                if email is not None:
                    cursor.execute(
                        """
                        SELECT id, full_name, email, password_hash, role, is_active
                        FROM users WHERE email = %s;
                        """,
                        (email,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT id, full_name, email, password_hash, role, is_active
                        FROM users WHERE id = %s;
                        """,
                        (user_id,),
                    )
                return cursor.fetchone()
    except psycopg.Error as error:
        logger.exception("Authentication database operation failed")
        raise HTTPException(
            status_code=503,
            detail="Login service unavailable. Please try again.",
        ) from error


def public_user(user):
    return {
        "id": user["id"],
        "full_name": user["full_name"],
        "email": user["email"],
        "role": user["role"],
    }


def unauthorized(message):
    return HTTPException(
        status_code=401,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/login")
def login(details: LoginRequest):
    user = find_user(email=details.email.strip().lower())
    stored_hash = user["password_hash"] if user else DUMMY_HASH
    password_matches = password_hasher.verify(details.password, stored_hash)

    if not user or not password_matches or not user["is_active"]:
        raise unauthorized("Incorrect email or password.")
    if user["role"] not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Staff access is required.")

    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": str(user["id"]),
            "iat": now,
            "exp": now + timedelta(minutes=TOKEN_MINUTES),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_MINUTES * 60,
        "user": public_user(user),
    }


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    if credentials is None:
        raise unauthorized("Please log in.")
    if credentials.scheme.lower() != "bearer":
        raise unauthorized("Please log in using a valid session.")

    try:
        payload = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"require": ["sub", "iat", "exp"]},
        )
        user_id = int(payload["sub"])
        if user_id <= 0 or user_id > 9223372036854775807:
            raise ValueError("Invalid user ID")
    except (InvalidTokenError, ValueError, TypeError) as error:
        raise unauthorized(
            "Your session is invalid or expired. Log in again."
        ) from error

    user = find_user(user_id=user_id)
    if not user or not user["is_active"]:
        raise unauthorized("Your account is unavailable.")
    if user["role"] not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Staff access is required.")
    return public_user(user)


def require_staff(user: dict = Depends(get_current_user)):
    """Admin and teacher are equal-access staff roles in this project."""
    if user["role"] not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Staff access is required.")
    return user


def require_admin(user: dict = Depends(require_staff)):
    """Compatibility name for existing routes; allows BOTH staff roles."""
    return user


def require_teacher_or_admin(user: dict = Depends(require_staff)):
    """Compatibility name for existing routes; allows BOTH staff roles."""
    return user


@router.get("/me")
def get_my_account(user: dict = Depends(get_current_user)):
    return user
