"""이메일 발송 유틸. SMTP(STARTTLS) 로 보내고, SMTP 미설정이면 서버 로그에 내용을 찍는
개발용 폴백으로 동작한다 — 자격증명 없이도 회원가입 인증 흐름을 테스트할 수 있게.

블로킹 소켓이므로 async 핸들러에서는 run_in_threadpool 로 오프로드해 부른다.
"""
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from config import Config

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, body: str) -> None:
    """to 에게 제목/본문 메일을 보낸다. SMTP 미설정이면 발송 대신 로그로 남긴다.

    실패 시 예외를 그대로 올린다(호출부가 사용자에게 실패를 알리도록).
    """
    if not Config.smtp_enabled():
        # 프로덕션(secure 쿠키)에서 SMTP 가 미설정이면 인증/복구 코드가 메일 대신 로그로
        # 새는 상태다. 조용히 흘리지 않고 실패시킨다 — 호출부가 502 로 사용자에게 알린다.
        if Config.SESSION_COOKIE_SECURE:
            raise RuntimeError(
                "SMTP 가 설정되지 않아 프로덕션에서 인증 메일을 보낼 수 없습니다. "
                "SMTP_HOST/SMTP_USER/SMTP_PASSWORD 를 설정하세요."
            )
        # 개발용(로컬, secure=false): SMTP 미설정이면 코드가 콘솔에 보이도록 남긴다.
        logger.warning(
            "[DEV MAIL] SMTP 미설정 — 실제 발송 안 함. 아래 내용을 콘솔로 대체.\n"
            "  To: %s\n  Subject: %s\n  %s", to, subject, body,
        )
        return

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = formataddr(('AI 가계부', Config.SMTP_FROM))
    msg['To'] = to
    msg.set_content(body)

    with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
        server.send_message(msg)
