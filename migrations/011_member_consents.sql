-- 011_member_consents.sql
-- 회원가입 시 약관(이용약관·개인정보처리방침) 동의 이력.
-- 어떤 버전(시행일)에 언제 동의했는지 남긴다 — 분쟁·법적 증빙 대비.
-- 약관이 개정되어 재동의를 받으면 행이 추가된다(기존 행은 갱신하지 않는다).
-- 탈퇴 시에는 개인정보처리방침의 파기 원칙에 따라 회원과 함께 삭제한다(ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS member_consents (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    member_id  INT UNSIGNED NOT NULL,
    doc        VARCHAR(20) NOT NULL COMMENT 'terms | privacy',
    version    VARCHAR(20) NOT NULL COMMENT '동의한 문서의 시행일(YYYY-MM-DD)',
    agreed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_mc_member (member_id),
    CONSTRAINT fk_mc_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
