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

    # CORS 허용 오리진(쉼표 구분). 미설정 시 로컬 개발용 기본값.
    CORS_ORIGINS = [
        o.strip()
        for o in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',')
        if o.strip()
    ]

    # BYOK: 서버 공용 AI 키는 두지 않는다. AI 키는 사용자별로 DB에 암호화 저장하고
    # (member_ai_credentials), 이 값을 암호화하는 별도 시크릿만 서버가 가진다. SECRET_KEY
    # 유출이 곧 모든 사용자 API 키 복호화로 번지지 않도록 분리한다. 미설정 시 SECRET_KEY
    # 파생 키로 폴백한다.
    AI_ENC_KEY = os.getenv('AI_ENC_KEY')

    # 카드 명세서 자동 수집 스케줄러(하루 1회 폴링) 사용 여부.
    CARD_IMPORT_SCHEDULER = _env_bool('CARD_IMPORT_SCHEDULER', True)
