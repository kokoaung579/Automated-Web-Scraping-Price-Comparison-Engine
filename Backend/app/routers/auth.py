import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

import smtplib
from email.message import EmailMessage

from app.config import (
    get_gmail_app_password,
    get_gmail_smtp_email,
    get_gmail_smtp_host,
    get_gmail_smtp_port,
)
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError

router = APIRouter(prefix="/api")

SESSION_COOKIE = "pricepilot_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 14
PASSWORD_ITERATIONS = 310_000
LEGACY_PASSWORD_ITERATIONS = 120_000
LOCAL_USER_MIGRATION_ID = "browser-local-users-to-mongodb-v1"
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9._-]{3,24}$")
DUMMY_SALT = bytes(16)
DUMMY_HASH = hashlib.pbkdf2_hmac(
    "sha256",
    b"invalid-password",
    DUMMY_SALT,
    PASSWORD_ITERATIONS,
)


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(APIModel):
    email: str
    username: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if len(normalized) > 254 or not EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = value.strip()
        if not USERNAME_PATTERN.fullmatch(normalized):
            raise ValueError(
                "Username must be 3–24 letters, numbers, dots, or dashes."
            )
        return normalized


class LoginRequest(APIModel):
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class UserStatusRequest(APIModel):
    status: Literal["Active", "Inactive"]


class LegacyAccountImport(APIModel):
    email: str
    username: str
    password_salt: str = Field(pattern=r"^[0-9a-fA-F]{32}$")
    password_hash: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    status: Literal["Active", "Inactive"] = "Active"
    registered_at: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if len(normalized) > 254 or not EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Legacy account email is invalid.")
        return normalized

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = value.strip()
        if not USERNAME_PATTERN.fullmatch(normalized):
            raise ValueError("Legacy account username is invalid.")
        return normalized

    @field_validator("registered_at")
    @classmethod
    def validate_registered_at(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Legacy account registration date is invalid.") from error
        return value


class LegacyAccountsImportRequest(APIModel):
    accounts: list[LegacyAccountImport] = Field(max_length=1000)


class OtpRequest(APIModel):
    email: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if len(normalized) > 254 or not EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


class VerifyOtpRequest(APIModel):
    email: str
    otp: str = Field(pattern=r"^\d{6}$")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if len(normalized) > 254 or not EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


class PublicUser(APIModel):
    id: str
    email: str
    username: str
    role: Literal["User", "Admin"]
    status: Literal["Active", "Inactive"]
    registeredAt: str
    emailVerified: bool = False


class LegacyImportResult(APIModel):
    imported: int
    skipped: int
    completed: bool


def _password_hash(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )


def _create_password_fields(password: str) -> dict:
    salt = secrets.token_bytes(16)
    return {
        "passwordSalt": salt.hex(),
        "passwordHash": _password_hash(
            password,
            salt,
            PASSWORD_ITERATIONS,
        ).hex(),
        "passwordIterations": PASSWORD_ITERATIONS,
    }


def _verify_password(password: str, user: dict | None) -> bool:
    if user is None:
        candidate = _password_hash(password, DUMMY_SALT, PASSWORD_ITERATIONS)
        hmac.compare_digest(candidate, DUMMY_HASH)
        return False

    try:
        salt = bytes.fromhex(user["passwordSalt"])
        expected = bytes.fromhex(user["passwordHash"])
        iterations = int(user["passwordIterations"])
        if iterations < 1:
            raise ValueError("Password iteration count must be positive.")
        candidate = _password_hash(password, salt, iterations)
    except (KeyError, TypeError, ValueError):
        candidate = _password_hash(password, DUMMY_SALT, PASSWORD_ITERATIONS)
        hmac.compare_digest(candidate, DUMMY_HASH)
        return False

    return hmac.compare_digest(candidate, expected)


def _public_user(document: dict) -> dict:
    email_verified = document.get(
        "emailVerified",
        document.get("email_verified", True),
    )
    return {
        "id": str(document["_id"]),
        "email": document["email"],
        "username": document["username"],
        "role": document["role"],
        "status": document["status"],
        "registeredAt": document["registeredAt"],
        "emailVerified": bool(email_verified),
    }


def _new_user(
    email: str,
    username: str,
    password: str,
    role: Literal["User", "Admin"] = "User",
) -> dict:
    return {
        "_id": str(uuid4()),
        "email": email,
        "username": username,
        "usernameKey": username.casefold(),
        **_create_password_fields(password),
        "role": role,
        "status": "Active",
        "registeredAt": datetime.now(timezone.utc).isoformat(),
        "emailVerified": False,
        "email_verified": False,
    }


async def initialize_auth_database(database) -> None:
    await database.users.create_index(
    [("email", 1)],
    unique=True,
    name="email_1",
)
    await database.users.create_index(
        "usernameKey",
        unique=True,
        partialFilterExpression={"usernameKey": {"$type": "string"}},
    )
    await database.sessions.create_index(
        "expiresAt",
        expireAfterSeconds=0,
    )
    await database.users.update_many(
        {"emailVerified": {"$exists": False}},
        {"$set": {"emailVerified": True, "email_verified": True}},
    )


async def ensure_bootstrap_admin(database) -> None:
    email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().casefold()
    username = os.getenv("BOOTSTRAP_ADMIN_USERNAME", "").strip()
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    configured = (email, username, password)

    if not any(configured):
        return
    if not all(configured):
        raise RuntimeError(
            "Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME, and "
            "BOOTSTRAP_ADMIN_PASSWORD together, or leave all three unset."
        )
    if not EMAIL_PATTERN.fullmatch(email):
        raise RuntimeError("BOOTSTRAP_ADMIN_EMAIL must be a valid email address.")
    if not USERNAME_PATTERN.fullmatch(username):
        raise RuntimeError(
            "BOOTSTRAP_ADMIN_USERNAME must be 3–24 letters, numbers, dots, or dashes."
        )
    if len(password) < 12:
        raise RuntimeError(
            "BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters."
        )

    existing = await database.users.find_one({"email": email})
    if existing is not None:
        if existing.get("role") != "Admin":
            raise RuntimeError(
                "The configured bootstrap email already belongs to a non-admin user."
            )
        return

    if await database.users.find_one({"usernameKey": username.casefold()}):
        raise RuntimeError(
            "The configured bootstrap username is already in use."
        )

    document = _new_user(email, username, password, role="Admin")
    document["emailVerified"] = True
    document["email_verified"] = True
    try:
        await database.users.insert_one(document)
    except DuplicateKeyError as error:
        raise RuntimeError(
            "The bootstrap admin email or username is already in use."
        ) from error


def _cookie_is_secure() -> bool:
    return os.getenv("APP_ENV", "production").strip().casefold() != "development"


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=_cookie_is_secure(),
        samesite="lax",
        path="/api",
    )


async def _create_session(database, user: dict, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=SESSION_TTL_SECONDS
    )
    await database.sessions.insert_one({
        "_id": hashlib.sha256(token.encode("ascii")).hexdigest(),
        "userId": user["_id"],
        "expiresAt": expires_at,
    })
    _set_session_cookie(response, token)


def get_database(request: Request):
    return request.app.state.database


async def get_request_user(request: Request, database) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None

    session_id = hashlib.sha256(token.encode("ascii")).hexdigest()
    session = await database.sessions.find_one({"_id": session_id})
    if session is None:
        return None

    expires_at = session.get("expiresAt")
    if not isinstance(expires_at, datetime):
        await database.sessions.delete_one({"_id": session_id})
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        await database.sessions.delete_one({"_id": session_id})
        return None

    user = await database.users.find_one({"_id": session["userId"]})
    if user is None or user.get("status") != "Active":
        await database.sessions.delete_one({"_id": session_id})
        return None
    return user


async def require_user(
    request: Request,
    database=Depends(get_database),
) -> dict:
    user = await get_request_user(request, database)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to continue.",
        )
    return user


async def require_admin(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required.",
        )
    return user


@router.post(
    "/auth/register",
    response_model=PublicUser,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    payload: RegisterRequest,
    response: Response,
    database=Depends(get_database),
):
    document = _new_user(
        payload.email,
        payload.username,
        payload.password,
    )
    document["emailVerified"] = True
    document["email_verified"] = True
    try:
        await database.users.insert_one(document)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email or username already exists.",
        )

    await _create_session(database, document, response)
    return _public_user(document)


@router.post("/auth/login", response_model=PublicUser)
async def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    database=Depends(get_database),
):
    identifier = payload.identifier.strip().casefold()
    user = await database.users.find_one({
        "$or": [
            {"email": identifier},
            {"usernameKey": identifier},
        ]
    })
    if not _verify_password(payload.password, user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or username and password do not match.",
        )
    email_verified = user.get(
        "emailVerified",
        user.get("email_verified", True),
    )
    if email_verified is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )
    if user.get("status") != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive. Contact an administrator.",
        )

    if int(user.get("passwordIterations", 0)) < PASSWORD_ITERATIONS:
        await database.users.update_one(
            {"_id": user["_id"]},
            {"$set": _create_password_fields(payload.password)},
        )

    await _create_session(database, user, response)
    try:
        from app.routers.audit import record_audit_log

        await record_audit_log(
            database,
            user_id=str(user["_id"]),
            user_email=user["email"],
            action="SIGN_IN",
            module="USER_MANAGEMENT",
            description="Signed in to the admin workspace.",
            ip_address=request.client.host if request.client else "",
            status="SUCCESS",
        )
    except Exception:
        pass
    return _public_user(user)


@router.get("/auth/session", response_model=PublicUser | None)
async def current_session(
    request: Request,
    database=Depends(get_database),
):
    user = await get_request_user(request, database)
    return _public_user(user) if user else None


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    database=Depends(get_database),
):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await database.sessions.delete_one({
            "_id": hashlib.sha256(token.encode("ascii")).hexdigest()
        })
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=_cookie_is_secure(),
        samesite="lax",
        path="/api",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get(
    "/admin/users",
    response_model=list[PublicUser],
    dependencies=[Depends(require_admin)],
)
async def list_users(
    database=Depends(get_database),
):
    documents = await database.users.find(
        {},
        {
            "_id": 1,
            "email": 1,
            "username": 1,
            "role": 1,
            "status": 1,
            "registeredAt": 1,
        },
    ).to_list(length=None)
    documents.sort(
        key=lambda document: document.get("registeredAt", ""),
        reverse=True,
    )
    return [_public_user(document) for document in documents]


@router.patch(
    "/admin/users/{email}/status",
    response_model=PublicUser,
)
async def update_user_status(
    email: str,
    payload: UserStatusRequest,
    request: Request,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    normalized_email = email.strip().casefold()
    user = await database.users.find_one({"email": normalized_email})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found.",
        )
    if (
        user["_id"] == admin["_id"]
        and payload.status == "Inactive"
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot deactivate the account currently in use.",
        )

    await database.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"status": payload.status}},
    )
    if payload.status == "Inactive":
        await database.sessions.delete_many({"userId": user["_id"]})
    user["status"] = payload.status
    try:
        from app.routers.audit import record_audit_log

        await record_audit_log(
            database,
            user_id=str(admin["_id"]),
            user_email=admin["email"],
            action="STATUS_CHANGE",
            module="USER_MANAGEMENT",
            description=f"Changed {email} to {payload.status}.",
            ip_address=request.client.host if request.client else "",
            status="SUCCESS",
        )
    except Exception:
        pass
    return _public_user(user)


@router.post(
    "/admin/users/import-browser",
    response_model=LegacyImportResult,
)
async def import_browser_users(
    payload: LegacyAccountsImportRequest,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    migrations = database.app_migrations
    migration = await migrations.find_one({"_id": LOCAL_USER_MIGRATION_ID})
    if migration is not None:
        return LegacyImportResult(
            imported=0,
            skipped=len(payload.accounts),
            completed=True,
        )

    imported = 0
    skipped = 0
    for account in payload.accounts:
        if account.email == admin["email"]:
            skipped += 1
            continue

        duplicate = await database.users.find_one({
            "$or": [
                {"email": account.email},
                {"usernameKey": account.username.casefold()},
            ]
        })
        if duplicate is not None:
            skipped += 1
            continue

        document = {
            "_id": str(uuid4()),
            "email": account.email,
            "username": account.username,
            "usernameKey": account.username.casefold(),
            "passwordSalt": account.password_salt.lower(),
            "passwordHash": account.password_hash.lower(),
            "passwordIterations": LEGACY_PASSWORD_ITERATIONS,
            "role": "User",
            "status": account.status,
            "registeredAt": account.registered_at,
            "emailVerified": True,
            "email_verified": True,
        }
        try:
            await database.users.insert_one(document)
            imported += 1
        except DuplicateKeyError:
            skipped += 1

    await migrations.update_one(
        {"_id": LOCAL_USER_MIGRATION_ID},
        {
            "$setOnInsert": {
                "completedAt": datetime.now(timezone.utc),
                "imported": imported,
            }
        },
        upsert=True,
    )
    return LegacyImportResult(
        imported=imported,
        skipped=skipped,
        completed=True,
    )


def _parse_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _send_otp_email(recipient: str, otp: str) -> None:
    sender = get_gmail_smtp_email()
    password = get_gmail_app_password()
    if not sender or not password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Gmail SMTP is not configured.",
        )

    host = get_gmail_smtp_host()
    port = get_gmail_smtp_port()
    message = EmailMessage()
    message["Subject"] = "Your SmartPrice verification code"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        f"Your SmartPrice verification code is {otp}. "
        "It expires in 5 minutes."
    )

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=20) as server:
                server.login(sender, password)
                server.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=20) as server:
                server.starttls()
                server.login(sender, password)
                server.send_message(message)
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not send the verification email.",
        ) from error


def _generate_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def _hash_otp(otp: str) -> str:
    return hashlib.sha256(otp.encode("utf-8")).hexdigest()


async def _issue_otp(database, user: dict) -> None:
    now = datetime.now(timezone.utc)
    last_sent = _parse_datetime(
        user.get("otpCreatedAt") or user.get("otp_created_at")
    )
    if last_sent is not None and (now - last_sent).total_seconds() < 60:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait 60 seconds before requesting another code.",
        )

    request_count = int(
        user.get("otpRequestCount")
        or user.get("otp_request_count")
        or 0
    )
    if last_sent is not None and (now - last_sent).total_seconds() > 15 * 60:
        request_count = 0
    if request_count >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many OTP requests. Try again later.",
        )

    otp = _generate_otp()
    _send_otp_email(user["email"], otp)
    hashed = _hash_otp(otp)
    expires_at = now + timedelta(minutes=5)

    await database.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "otpHash": hashed,
                "otp_hash": hashed,
                "otpExpiresAt": expires_at,
                "otp_expires_at": expires_at,
                "otpCreatedAt": now,
                "otp_created_at": now,
                "otpRequestCount": request_count + 1,
                "otp_request_count": request_count + 1,
                "otpAttempts": 0,
                "otp_attempts": 0,
            }
        },
    )


async def _verify_otp(database, email: str, otp: str) -> dict:
    user = await database.users.find_one({"email": email})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found.",
        )

    stored_hash = user.get("otpHash") or user.get("otp_hash")
    expires_at = _parse_datetime(
        user.get("otpExpiresAt") or user.get("otp_expires_at")
    )
    now = datetime.now(timezone.utc)
    if not stored_hash or expires_at is None or expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP expired or invalid.",
        )

    attempts = int(
        user.get("otpAttempts") or user.get("otp_attempts") or 0
    )
    if attempts >= 5:
        await database.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "otpHash": None,
                    "otp_hash": None,
                    "otpExpiresAt": None,
                    "otp_expires_at": None,
                }
            },
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many incorrect attempts. Request a new OTP.",
        )

    if not hmac.compare_digest(_hash_otp(otp), stored_hash):
        await database.users.update_one(
            {"_id": user["_id"]},
            {
                "$inc": {
                    "otpAttempts": 1,
                    "otp_attempts": 1,
                }
            },
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect OTP.",
        )

    await database.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "emailVerified": True,
                "email_verified": True,
                "otpHash": None,
                "otp_hash": None,
                "otpExpiresAt": None,
                "otp_expires_at": None,
                "otpCreatedAt": None,
                "otp_created_at": None,
            }
        },
    )
    user["emailVerified"] = True
    user["email_verified"] = True
    return user


@router.post("/auth/verify-otp")
@router.post("/auth/otp/verify")
async def verify_otp_endpoint(
    payload: VerifyOtpRequest,
    database=Depends(get_database),
):
    user = await _verify_otp(database, payload.email, payload.otp)
    return _public_user(user)


@router.post("/auth/resend-otp")
@router.post("/auth/send-otp")
@router.post("/auth/otp/resend")
@router.post("/auth/request-otp")
async def resend_otp_endpoint(
    payload: OtpRequest,
    database=Depends(get_database),
):
    user = await database.users.find_one({"email": payload.email})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found.",
        )

    email_verified = user.get(
        "emailVerified",
        user.get("email_verified", False),
    )
    if email_verified is True:
        return {"message": "Email is already verified."}

    await _issue_otp(database, user)
    return {"message": "OTP sent."}
