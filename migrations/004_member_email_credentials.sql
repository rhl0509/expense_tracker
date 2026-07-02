-- 004_member_email_credentials.sql
-- 멤버별 카드 명세서 수집용 Gmail IMAP 자격증명(암호화 저장).
-- 공용 Config 계정을 모든 사용자가 공유하던 구조(테넌트 간 유출 위험)를 대체한다.
-- 앱 비밀번호·우리카드 생년월일은 Fernet(SECRET_KEY 파생 키)로 암호화해 저장한다.
-- SECRET_KEY 를 교체하면 기존 암호문은 복호화 불가 → 사용자가 재입력해야 한다.

CREATE TABLE IF NOT EXISTS member_email_credentials (
    member_id         INT UNSIGNED NOT NULL PRIMARY KEY,
    imap_user         VARCHAR(255) NOT NULL,
    imap_password_enc VARBINARY(512) NOT NULL,
    woori_birth_enc   VARBINARY(255) NULL,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_mec_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
