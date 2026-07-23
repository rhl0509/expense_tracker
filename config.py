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

    # ── 로컬 LLM (provider='local') ──────────────────────────────────────
    # OpenAI 호환 엔드포인트를 내는 로컬 추론 서버 주소. 예: Ollama → http://localhost:11434/v1
    # **미설정이면 'local' 프로바이더 자체가 비활성**이다. 기본값을 넣지 않는 이유:
    # 로컬 서버가 없는 곳(배포 인스턴스)에서 'local'을 고를 수 있으면 사용자는 저장에
    # 성공한 뒤 매 호출마다 연결 실패만 보게 된다.
    #
    # 이 값은 **환경변수로만** 정한다. 사용자 입력으로 base_url 을 받으면 서버가 임의
    # 주소로 요청하는 통로(SSRF)가 되므로, 요청 본문·쿼리에서 절대 읽지 않는다.
    LOCAL_LLM_URL   = (os.getenv('LOCAL_LLM_URL') or '').strip()
    LOCAL_LLM_MODEL = (os.getenv('LOCAL_LLM_MODEL') or 'qwen2.5:latest').strip()

    # ── 이메일 발송 (회원가입 인증코드) ──────────────────────────────────
    # 회원가입 시 이메일로 6자리 인증코드를 보낸다. **미설정이면 실제 발송 대신 서버 로그에
    # 코드를 찍는 개발용 폴백**으로 동작한다(자격증명 없이 흐름을 바로 테스트하기 위함).
    # Gmail 예: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=[email protected],
    #          SMTP_PASSWORD=<앱 비밀번호 16자>. SMTP_FROM 미설정 시 SMTP_USER 를 발신자로 쓴다.
    SMTP_HOST     = (os.getenv('SMTP_HOST') or '').strip()
    SMTP_PORT     = int(os.getenv('SMTP_PORT', '587'))
    SMTP_USER     = (os.getenv('SMTP_USER') or '').strip()
    SMTP_PASSWORD = os.getenv('SMTP_PASSWORD') or ''
    SMTP_FROM     = (os.getenv('SMTP_FROM') or os.getenv('SMTP_USER') or '').strip()

    @classmethod
    def local_llm_enabled(cls) -> bool:
        return bool(cls.LOCAL_LLM_URL)

    @classmethod
    def smtp_enabled(cls) -> bool:
        return bool(cls.SMTP_HOST and cls.SMTP_USER and cls.SMTP_PASSWORD)
