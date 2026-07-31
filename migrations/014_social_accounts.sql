-- 014: 소셜 로그인(구글·카카오·네이버). 신원 키는 (provider, provider_user_id) 하나다.
-- 이메일은 신원 키가 아니다 — 프로바이더 계정의 이메일이 바뀌어도 여기 매핑은 그대로다.

-- 소셜 전용 회원은 아이디·비밀번호가 없다. NULL = "그 자격증명이 없음".
-- (자리표시자 해시를 넣지 않는다 — "비밀번호 없음"과 "어떤 비밀번호 있음"을 코드가
-- 구분할 수 없게 된다. NULL 은 스키마 자체가 사실을 말한다.)
-- email 은 "이 앱이 소유를 확인한 이메일"만 저장한다(자체 인증코드 통과 또는 프로바이더
-- verified). 미확인이면 NULL — 가짜 이메일 채움 금지. MySQL UNIQUE 인덱스는 NULL 중복을
-- 허용하므로 uk_members_user_id / uk_members_email 은 그대로 둔다.
ALTER TABLE members
  MODIFY COLUMN user_id       varchar(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '로그인 아이디. 소셜 전용 회원은 NULL',
  MODIFY COLUMN password_hash varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '암호화된 비밀번호. 소셜 전용 회원은 NULL',
  MODIFY COLUMN email         varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '소유가 확인된 이메일만 저장. 미확인이면 NULL';

CREATE TABLE IF NOT EXISTS member_social_accounts (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    member_id        INT UNSIGNED NOT NULL,
    provider         VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'google | kakao | naver',
    provider_user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '프로바이더의 불변 식별자(google sub / kakao id / naver id)',
    provider_email   VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '프로바이더가 알려준 이메일. 참고·지원용이며 신원 판단에 쓰지 않는다',
    linked_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at    DATETIME DEFAULT NULL,
    -- 한 소셜 신원은 최대 한 회원에게만 붙는다. "남의 소셜을 내 계정에도 붙이기"를 DB에서 막는다.
    UNIQUE KEY uq_provider_user (provider, provider_user_id),
    -- 한 회원당 프로바이더별 1개. 마이페이지 연결 UI가 단순해진다.
    UNIQUE KEY uq_member_provider (member_id, provider),
    CONSTRAINT fk_msa_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
