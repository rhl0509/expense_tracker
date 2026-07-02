-- 001_multitenancy.sql
-- 멀티 가구(account_book) 지원: 멤버십 + 초대 테이블 추가 및 기존 데이터 백필.
-- gagebu DB 대상. 재실행 안전(IF NOT EXISTS / INSERT IGNORE).

-- 누가 어느 가구(장부)에 속하는지.
CREATE TABLE IF NOT EXISTS account_book_members (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    account_book_id INT UNSIGNED NOT NULL,
    member_id       INT UNSIGNED NOT NULL,
    role            ENUM('owner','member') NOT NULL DEFAULT 'member',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_book_member (account_book_id, member_id),
    KEY idx_member (member_id),
    CONSTRAINT fk_abm_book   FOREIGN KEY (account_book_id) REFERENCES account_books(id) ON DELETE CASCADE,
    CONSTRAINT fk_abm_member FOREIGN KEY (member_id)       REFERENCES members(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 가구 초대(토큰 기반).
CREATE TABLE IF NOT EXISTS account_book_invites (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    account_book_id INT UNSIGNED NOT NULL,
    token           VARCHAR(64) NOT NULL,
    invited_email   VARCHAR(255) NULL,
    status          ENUM('pending','accepted','revoked','expired') NOT NULL DEFAULT 'pending',
    created_by      INT UNSIGNED NOT NULL,
    accepted_by     INT UNSIGNED NULL,
    expires_at      DATETIME NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_token (token),
    KEY idx_book (account_book_id),
    CONSTRAINT fk_inv_book     FOREIGN KEY (account_book_id) REFERENCES account_books(id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_creator  FOREIGN KEY (created_by)      REFERENCES members(id),
    CONSTRAINT fk_inv_acceptor FOREIGN KEY (accepted_by)     REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 백필 1: 각 장부의 소유자를 owner 멤버로.
INSERT IGNORE INTO account_book_members (account_book_id, member_id, role)
SELECT id, member_id, 'owner' FROM account_books;

-- 백필 2: 거래를 남긴 (장부, member)를 member로. (이미 owner면 UNIQUE로 무시됨)
INSERT IGNORE INTO account_book_members (account_book_id, member_id, role)
SELECT DISTINCT account_book_id, member_id, 'member'
FROM transactions
WHERE member_id IS NOT NULL;
