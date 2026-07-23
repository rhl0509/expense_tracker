-- schema.sql — 완성 스키마 (migrations 001~013 이 반영된 전체 구조).
-- 빈 DB(RDS 등)에 이 파일 하나로 스키마를 세운다. 이후 새 마이그레이션만 순차 적용.
-- 생성 방식: SHOW CREATE TABLE 덤프 (AUTO_INCREMENT 시작값은 제거).

SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE `account_book_invites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_book_id` int unsigned NOT NULL,
  `token` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('pending','accepted','revoked','expired') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `created_by` int unsigned NOT NULL,
  `accepted_by` int unsigned DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token` (`token`),
  KEY `idx_book` (`account_book_id`),
  KEY `fk_inv_creator` (`created_by`),
  KEY `fk_inv_acceptor` (`accepted_by`),
  CONSTRAINT `fk_inv_acceptor` FOREIGN KEY (`accepted_by`) REFERENCES `members` (`id`),
  CONSTRAINT `fk_inv_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inv_creator` FOREIGN KEY (`created_by`) REFERENCES `members` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `account_book_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_book_id` int unsigned NOT NULL,
  `member_id` int unsigned NOT NULL,
  `role` enum('owner','member') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'member',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_book_member` (`account_book_id`,`member_id`),
  KEY `idx_member` (`member_id`),
  CONSTRAINT `fk_abm_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_abm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `account_books` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '가계부 PK',
  `member_id` int unsigned NOT NULL COMMENT '회원 PK',
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '가계부 이름',
  `description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '가계부 설명',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일',
  PRIMARY KEY (`id`),
  KEY `idx_account_books_member_id` (`member_id`),
  CONSTRAINT `fk_account_books_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='가계부 테이블';

CREATE TABLE `card_import_ledger` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `account_book_id` int unsigned NOT NULL,
  `fingerprint` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `line_seq` smallint unsigned NOT NULL DEFAULT '1',
  `transaction_date` date NOT NULL,
  `merchant` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `payment_method` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `member_id` int unsigned DEFAULT NULL,
  `transaction_id` int unsigned DEFAULT NULL,
  `first_imported_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cil_book_fp_seq` (`account_book_id`,`fingerprint`,`line_seq`),
  KEY `idx_cil_member` (`member_id`),
  CONSTRAINT `fk_cil_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cil_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='카드 명세서 자동수집 원장(수집한 라인 지문 영구 기록)';

CREATE TABLE `card_import_schedule` (
  `id` tinyint unsigned NOT NULL,
  `last_run_at` timestamp NULL DEFAULT NULL COMMENT '_import_all_members() 를 마지막으로 시도한 시각(성공·실패 무관)',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_cis_singleton` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='카드 자동수집 스케줄러 상태(단일 행)';

CREATE TABLE `categories` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '카테고리 PK',
  `account_book_id` int unsigned NOT NULL COMMENT '가계부 PK',
  `type` enum('income','expense') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '수입/지출 구분',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '카테고리명',
  `icon` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'bi-tag' COMMENT 'Bootstrap Icon 클래스명',
  `color` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '표시 색상',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일',
  `parent_id` int unsigned DEFAULT NULL,
  `user` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '공용',
  `member_id` int DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_categories_account_book_id` (`account_book_id`),
  KEY `idx_categories_type` (`type`),
  KEY `fk_category_parent` (`parent_id`),
  CONSTRAINT `fk_categories_account_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_category_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='가계부 카테고리 테이블';

CREATE TABLE `member_ai_credentials` (
  `member_id` int unsigned NOT NULL,
  `provider` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'anthropic',
  `api_key_enc` varbinary(512) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`member_id`),
  CONSTRAINT `fk_aic_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `member_consents` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `member_id` int unsigned NOT NULL,
  `doc` varchar(20) COLLATE utf8mb4_general_ci NOT NULL COMMENT 'terms | privacy',
  `version` varchar(20) COLLATE utf8mb4_general_ci NOT NULL COMMENT '동의한 문서의 시행일(YYYY-MM-DD)',
  `agreed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mc_member` (`member_id`),
  CONSTRAINT `fk_mc_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `member_email_credentials` (
  `member_id` int unsigned NOT NULL,
  `imap_user` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `imap_password_enc` varbinary(512) NOT NULL,
  `woori_birth_enc` varbinary(255) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`member_id`),
  CONSTRAINT `fk_mec_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `members` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `user_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '로그인 아이디',
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '암호화된 비밀번호',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '이름',
  `email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '이메일',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '전화번호',
  `role` enum('free','basic','premium','pro','admin') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'free',
  `status` enum('active','inactive','suspended') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'active' COMMENT '계정 상태',
  `members_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '사원번호',
  `last_login_at` datetime DEFAULT NULL COMMENT '마지막 로그인 시간',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일',
  `watchlist` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_members_user_id` (`user_id`),
  UNIQUE KEY `uk_members_email` (`email`),
  UNIQUE KEY `uk_members_members_no` (`members_no`),
  KEY `idx_members_role` (`role`),
  KEY `idx_members_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='LMS 회원 테이블';

CREATE TABLE `recurring_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_book_id` int DEFAULT NULL,
  `category_id` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `type` enum('expense','income') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'expense',
  `repeat_day` int NOT NULL,
  `user` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '공용',
  `payment_method` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `amount` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `last_processed_month` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_book_id` int DEFAULT '2',
  `setting_key` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `setting_value` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_book_setting` (`account_book_id`,`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `stock_ingest_ledger` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `account_book_id` int unsigned NOT NULL,
  `idempotency_key` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `transaction_id` int unsigned DEFAULT NULL,
  `token_id` int unsigned DEFAULT NULL,
  `amount` decimal(15,2) NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sil_book_idem` (`account_book_id`,`idempotency_key`),
  KEY `idx_sil_token` (`token_id`),
  CONSTRAINT `fk_sil_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sil_token` FOREIGN KEY (`token_id`) REFERENCES `stock_ingest_token` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='주식 앱 자동기록 원장(멱등키 영구 기록 — 거래를 지워도 부활 금지)';

CREATE TABLE `stock_ingest_token` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `member_id` int unsigned NOT NULL,
  `account_book_id` int unsigned NOT NULL,
  `label` varchar(50) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `expires_at` datetime DEFAULT NULL,
  `last_used_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sit_hash` (`token_hash`),
  KEY `idx_sit_member` (`member_id`),
  KEY `fk_sit_book` (`account_book_id`),
  CONSTRAINT `fk_sit_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sit_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='주식 앱 연동 토큰(해시만 저장, 행이 member·book 을 결정)';

CREATE TABLE `transactions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '거래내역 PK',
  `account_book_id` int unsigned NOT NULL COMMENT '가계부 PK',
  `category_id` int unsigned DEFAULT NULL,
  `member_id` int unsigned NOT NULL COMMENT '작성자 회원 PK',
  `type` enum('income','expense') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '수입/지출 구분',
  `amount` decimal(15,2) NOT NULL COMMENT '금액 (정밀도 상향)',
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '내역 제목',
  `memo` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '메모',
  `transaction_date` date NOT NULL COMMENT '거래일',
  `payment_method` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '결제수단',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일',
  `user` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '공용',
  PRIMARY KEY (`id`),
  KEY `idx_transactions_account_book_id` (`account_book_id`),
  KEY `idx_transactions_category_id` (`category_id`),
  KEY `idx_transactions_member_id` (`member_id`),
  KEY `idx_transactions_date` (`transaction_date`),
  KEY `idx_transactions_type` (`type`),
  KEY `idx_transactions_date_book` (`account_book_id`,`transaction_date`),
  CONSTRAINT `fk_transactions_account_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_transactions_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_transactions_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='가계부 거래내역 테이블';

CREATE TABLE `reset_batches` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `account_book_id` int unsigned NOT NULL COMMENT '초기화된 가구',
  `member_id` int unsigned NOT NULL COMMENT '초기화 실행자(참고용, FK 없음)',
  `tx_count` int unsigned NOT NULL DEFAULT '0' COMMENT '아카이브된 거래 수',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '초기화 시각',
  `restored_at` datetime DEFAULT NULL COMMENT '복원 시각(NULL=미복원)',
  PRIMARY KEY (`id`),
  KEY `idx_reset_batches_book` (`account_book_id`,`restored_at`),
  CONSTRAINT `fk_reset_batches_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='데이터 초기화 이벤트(아카이브 배치)';

CREATE TABLE `transactions_archive` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `batch_id` int unsigned NOT NULL COMMENT '초기화 배치(reset_batches.id)',
  `original_id` int unsigned NOT NULL COMMENT '원본 transactions.id (참고용)',
  `account_book_id` int unsigned NOT NULL,
  `category_id` int unsigned DEFAULT NULL COMMENT '원본 카테고리(FK 없음 — 복원 시 존재 검증)',
  `member_id` int unsigned NOT NULL COMMENT '원본 작성자(FK 없음 — 복원 시 존재 검증)',
  `type` enum('income','expense') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `memo` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `transaction_date` date NOT NULL,
  `payment_method` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime NOT NULL COMMENT '원본 생성일 보존',
  `updated_at` datetime NOT NULL COMMENT '원본 수정일 보존',
  `user` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '공용',
  PRIMARY KEY (`id`),
  KEY `idx_tx_archive_batch` (`batch_id`),
  CONSTRAINT `fk_tx_archive_batch` FOREIGN KEY (`batch_id`) REFERENCES `reset_batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='초기화로 아카이브된 거래내역';

-- migrations/012 — 가맹점 자동분류 개인 캐시(장부별)
CREATE TABLE `merchant_category_map` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `account_book_id` int unsigned NOT NULL,
  `merchant_key` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '정규화된 가맹점명(소문자·공백접기)',
  `category_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'categories.name 과 대조해 쓴다',
  `source` enum('ai','user') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'ai',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_book_merchant` (`account_book_id`,`merchant_key`),
  CONSTRAINT `fk_mcm_account_book` FOREIGN KEY (`account_book_id`) REFERENCES `account_books` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='가맹점 자동분류 캐시';

-- migrations/013 — 전역 가맹점 카탈로그(장부 무관·선큐레이션). 프라이버시: 가맹점명→카테고리만, "누가 갔는지" 없음.
CREATE TABLE `merchant_catalog` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `merchant_key` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '정규화된 가맹점명(소문자·공백접기)',
  `category_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '기본 10 카테고리 중 하나',
  `source` enum('curated') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'curated' COMMENT 'rho 선큐레이션 전용 — 런타임 승격 없음',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_merchant` (`merchant_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='전역 가맹점 분류 카탈로그(장부 무관·선큐레이션)';

SET FOREIGN_KEY_CHECKS=1;
