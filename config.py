# DB 연결 및 비밀키 등 설정 파일
import os
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

_secret_key = os.getenv('SECRET_KEY')
if not _secret_key:
    raise RuntimeError("SECRET_KEY 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.")
if len(_secret_key) < 32:
    raise RuntimeError("SECRET_KEY가 너무 짧습니다. 최소 32자 이상의 무작위 값을 사용하세요.")


def _env_bool(name, default=False):
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in ('1', 'true', 'yes', 'on')


class Config:
    """앱 설정 (환경변수 로드)."""

    SECRET_KEY = _secret_key

    # MySQL 연결 설정
    MYSQL_HOST     = os.getenv('DB_HOST', 'localhost')
    MYSQL_USER     = os.getenv('DB_USER', 'root')
    MYSQL_PASSWORD = os.getenv('DB_PASSWORD', '')
    MYSQL_DB       = os.getenv('DB_NAME', 'expense_tracker')

    # HTTPS 배포 시 세션 쿠키에 Secure 플래그를 붙인다(HTTP 로컬/Tailscale 접속은 false 유지).
    SESSION_COOKIE_SECURE = _env_bool('SESSION_COOKIE_SECURE', False)

    ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')

    # 카드명세서 자동수집용 Gmail IMAP (앱 비밀번호)
    GMAIL_IMAP_USER     = os.getenv('GMAIL_IMAP_USER')
    GMAIL_IMAP_PASSWORD = os.getenv('GMAIL_IMAP_PASSWORD')

    # 우리카드 VestMail 보안메일 복호화용 생년월일 6자리(없으면 우리카드는 건너뜀)
    WOORI_BIRTH = os.getenv('WOORI_BIRTH')
