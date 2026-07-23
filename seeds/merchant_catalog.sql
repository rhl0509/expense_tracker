-- seeds/merchant_catalog.sql — 전역 가맹점 카탈로그 시드 (선큐레이션 결과, 수기 확정).
--
-- merchant_key 는 지점명을 벗긴 **브랜드**다(런타임은 브랜드 접두 매칭 —
-- merchant_classifier._match_global). 그래서 '이마트'는 '이마트 죽전점'·'이마트서수원점'
-- 등 모든 지점에 걸린다. category_name 은 기본 10 카테고리 중 하나.
--
-- 선정 기준(자동 선큐레이션 후 수기 확정):
--   ① 전국 대형 프랜차이즈만 — 지역 개별 상호·결제대행은 제외
--   ② 한글 표기만 — 로마자/일본 가맹점은 명세서 원문과 브랜드 음역이 달라 매칭 불가라 제외
--   ③ card_statement 키워드 룰이 못 잡는 것만 — 룰이 잡는 브랜드는 여기 중복 안 넣음
--   ④ 카테고리가 명확한 것만 — 32B가 오분류/환각한 항목(크린토피아→식비(세탁소);
--      애니카랜드→취미/문화(정비소); NEWCHITOSEAPTT(공항)→통신 등)은 전부 제외
--
-- 적용: mysql ... < seeds/merchant_catalog.sql   (migrations/013 이후)
-- 재적용 안전(ON DUPLICATE KEY UPDATE). 브랜드를 늘릴 땐 같은 4기준으로 추가한다.

INSERT INTO merchant_catalog (merchant_key, category_name, source) VALUES
  ('김밥천국',     '식비', 'curated'),
  ('이디야',       '식비', 'curated'),
  ('투썸플레이스', '식비', 'curated'),
  ('롯데리아',     '식비', 'curated'),
  ('맘스터치',     '식비', 'curated'),
  ('써브웨이',     '식비', 'curated'),
  ('파리바게뜨',   '식비', 'curated'),
  ('이마트',       '쇼핑', 'curated'),
  ('코스트코',     '쇼핑', 'curated')
ON DUPLICATE KEY UPDATE category_name = VALUES(category_name);
