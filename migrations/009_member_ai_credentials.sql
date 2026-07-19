-- 009_member_ai_credentials.sql
-- 멤버별 AI 프로바이더 API 키(암호화 저장). BYOK(Bring Your Own Key).
-- 서버 공용 키(ANTHROPIC_API_KEY)를 모든 사용자가 공유하던 구조를 대체한다 —
-- 배포 시 서버에 공유 키를 두지 않고, 각 사용자가 자기 키를 등록해 자기 비용으로 AI 를 쓴다.
-- 키는 Fernet(AI_ENC_KEY 있으면 그것, 없으면 SECRET_KEY 파생)로 암호화해 저장한다.
-- 암호화 키를 교체하면 기존 암호문은 복호화 불가 → 사용자가 재입력해야 한다.

CREATE TABLE IF NOT EXISTS member_ai_credentials (
    member_id    INT UNSIGNED NOT NULL PRIMARY KEY,
    provider     VARCHAR(20)    NOT NULL DEFAULT 'anthropic',
    api_key_enc  VARBINARY(512) NOT NULL,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_aic_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
