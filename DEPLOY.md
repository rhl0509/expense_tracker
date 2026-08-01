# 배포 가이드 (AWS)

가계부(AI 가계부)를 AWS에 올리는 절차. 아키텍처는 **EC2 1대(앱 컨테이너 3개) + RDS 1대(MySQL)**.

```
브라우저 ─HTTPS─▶ Caddy(EC2:443) ─▶ frontend(Next standalone) ─▶ backend(FastAPI)
                                                                        │
                                                              RDS MySQL(별도, SSL)
```

Caddy만 외부에 열리고 frontend·backend는 컨테이너 내부 네트워크에만 있다.

---

## 이미 준비된 것 (코드/산출물)

- `Dockerfile`(백엔드, Node 포함·비루트 실행), `frontend/Dockerfile`(Next standalone·비루트), `docker-compose.yml`, `Caddyfile`, `Caddy.Dockerfile`(rate_limit 플러그인 빌드)
- Caddy 앞단 방어: 요청 본문 10MB 제한(DoS), `/auth/register`·`/auth/login` IP당 레이트리밋(10회/분)
- `next.config.ts` `output: "standalone"` + `/integration` rewrites
- `app.py` `BIND_HOST` env (컨테이너에서 `0.0.0.0`)
- `database/db_connection.py` `DB_SSL_CA` 설정 시 TLS 연결
- `requirements.txt` 버전 고정
- `schema.sql` — 빈 DB에 한 번에 적용하는 완성 스키마(migrations 001~014 반영)
- `seeds/merchant_catalog.sql` — 전역 가맹점 분류 카탈로그 데이터(선택). 스키마와 분리된 **데이터** 시드
- BYOK: 서버 공용 AI 키 없음(사용자별 키). `AI_ENC_KEY`로 암호화(미설정 시 `SECRET_KEY` 파생)
- 가맹점 자동분류: 런타임은 `merchant_catalog`(전역 캐시) **조회만** 한다 — 배포본은 AI를 호출하지 않는다. 카탈로그는 로컬에서 `tools/curate_merchant_catalog.py`로 선큐레이션(로컬 LLM)해 시드로 넣는다

## 로컬에서 배포 구성 검증

```bash
# .env 에 DB_HOST=host.docker.internal (호스트 MySQL 사용 시), DB_SSL_CA 는 비워둔다
docker compose up --build
# https://localhost 접속 (로컬은 Caddy 내부 인증서 → 브라우저 경고 정상)
```
**접속만으로 끝내지 말고 실제로 로그인까지 눌러본다.** Next 의 rewrites 목적지는 빌드 시점에
굳기 때문에, 잘못 빌드되면 페이지·헬스체크·HTTPS 는 전부 정상인데 API 만 전멸한다. 빌드 산출물로
바로 확인할 수도 있다:
```bash
docker compose run --rm frontend node -e "console.log(JSON.stringify(require('/app/.next/routes-manifest.json').rewrites.afterFiles[0]))"
# destination 이 http://backend:5000/... 이어야 한다 (127.0.0.1:8010 이면 잘못 빌드된 것)
```

---

## AWS 배포 순서

> 순서가 중요하다. RDS 는 퍼블릭 액세스를 막고 3306 을 EC2 보안그룹에서만 여는데,
> 그러면 **EC2 가 생기기 전에는 RDS 에 접속할 경로가 없다** — 스키마 적재는 3단계다.

### 1. 보안그룹 2개 (RDS 보다 먼저)
- `gagebu-ec2-sg`: 인바운드 80·443 ← `0.0.0.0/0`, 22 ← **본인 IP만**
- `gagebu-rds-sg`: 인바운드 3306 ← **소스로 `gagebu-ec2-sg` 지정**(IP 대역이 아니라 보안그룹)

### 2. RDS (MySQL)
- db.t3.micro, MySQL 8, DB 이름 `gagebu`. **퍼블릭 액세스 "아니요".** 보안그룹 `gagebu-rds-sg`.
- **스토리지 암호화 켜기**(생성 후에는 못 바꾼다). 자동 백업 보존 기간 확인(기본값은 ⚠️ 확인 필요).
- 파라미터그룹에서 **`require_secure_transport=ON`** — 평문 접속을 서버가 거부하게 한다.
  이게 없으면 `DB_SSL_CA` 설정이 빠졌을 때 경고 없이 평문으로 붙는다.

### 3. EC2 + 소스 배치
- t3.micro, Ubuntu LTS, 보안그룹 `gagebu-ec2-sg`, 루트 볼륨 **16GB 권장**(8GB 는 빌드 잔여
  레이어 + 로그로 금방 찬다). 퍼블릭 IP 는 **탄력적 IP** 로 고정(재시작 시 IP 변경 방지).
- Docker + compose 설치 후 **`sudo systemctl enable docker`** — 안 하면 재부팅 후 컨테이너가
  안 올라오고 `restart: unless-stopped` 도 소용없다.
- **스왑 2GB 먼저**(t3.micro 1GB 에서 `next build` OOM 방지):
  `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
  (영구화는 `/etc/fstab` 에 `/swapfile none swap sw 0 0`)
- **소스 배치**: private 레포이므로 GitHub **배포 키(읽기 전용)** 를 EC2 에 두고 clone 하거나,
  로컬에서 `rsync -av --exclude-from=.dockerignore ./ ubuntu@<IP>:~/expense_tracker/` 로 보낸다.
- **RDS CA 번들**을 `secrets/rds-ca.pem` 에 둔다(compose 가 `./secrets` 를 마운트한다):
  `curl -o secrets/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`
- mysql 클라이언트 설치: `sudo apt install -y mysql-client`
- **스키마 적재**(여기서 처음으로 RDS 에 닿는다):
  `mysql -h <RDS엔드포인트> -u <user> -p <db> < schema.sql`
  — `schema.sql` 은 001~014 가 반영된 완성 스키마다. 이후 **새로 추가되는** 마이그레이션만
  번호순으로 적용한다(증분만으로는 베이스 테이블이 안 생겨 빈 DB 구축이 실패한다).
  두 번째 배포부터는 **마이그레이션 먼저 → 코드 배포** 순서를 지키고, 어디까지 적용했는지 기록한다.
- (선택) 가맹점 카탈로그 시드: `mysql -h ... < seeds/merchant_catalog.sql` — 스키마 뒤에 데이터로
  적용한다. 재적용 안전(`ON DUPLICATE KEY UPDATE`). 없어도 앱은 동작한다(룰 + 기타 분류).

### 4. 환경변수(.env, EC2)
필수:
```
SECRET_KEY=<32자+ 무작위>
AI_ENC_KEY=<SECRET_KEY 와 다른 무작위>   # 유출면 분리
DB_HOST=<RDS 엔드포인트>
DB_USER= / DB_PASSWORD= / DB_NAME=
DB_SSL_CA=/etc/ssl/app/rds-ca.pem      # 컨테이너 안 경로(호스트의 secrets/rds-ca.pem)
SESSION_COOKIE_SECURE=true
CORS_ORIGINS=https://<도메인>
DOMAIN=<도메인>
BIND_HOST=0.0.0.0
```

소셜 로그인(선택 — 켜려면 전부 설정):
```
APP_BASE_URL=https://<도메인>          # redirect_uri 기준. 미설정이면 소셜 전체 비활성
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
KAKAO_CLIENT_ID= / KAKAO_CLIENT_SECRET=   # 앱 설정 → 플랫폼 키 (시크릿은 기본 발급·활성)
NAVER_CLIENT_ID= / NAVER_CLIENT_SECRET=
```
- 각 프로바이더 콘솔에 `https://<도메인>/auth/social/{provider}/callback` 을 redirect_uri 로 등록한다.
- 카카오 이메일(account_email) 동의항목은 비즈 앱 전환이 필요하다 — 전환 전에도 동작한다
  (이메일이 안 오면 가입 시 자체 이메일 인증으로 대체). 네이버 이메일도 검증 주장이 없어 같은 취급.
- 네이버는 검수 신청 전까지 등록된 테스터만 로그인될 수 있다(콘솔에서 확인 — ⚠️ 검증 필요).

### 5. DNS 먼저, 그다음 기동
**순서를 바꾸면 안 된다.** Caddy 는 기동 즉시 `DOMAIN` 에 대해 ACME 검증을 시도하는데,
그때 도메인이 EC2 를 안 가리키면 실패가 누적되고 Let's Encrypt 발급 한도에 걸릴 수 있다.
이 배포에서 **코드 수정으로 즉시 되돌릴 수 없는 유일한 지점**이다.

```bash
# ① A레코드를 EC2 탄력적 IP 로 지정한 뒤 전파 확인
dig +short <도메인>          # EC2 IP 가 나와야 한다
# ② .env 에 DOMAIN 이 있는지 확인 (없으면 Caddyfile 이 localhost 로 떨어져 매칭 실패)
grep '^DOMAIN=' .env
# ③ 순차 빌드 — 동시 빌드는 t3.micro 1GB 에서 next build 와 xcaddy(Go 링커)가 겹쳐 스래싱한다
docker compose build backend && docker compose build frontend && docker compose build caddy
docker compose up -d
```

- 기동 후 `docker compose ps` 로 backend·frontend 가 **healthy** 인지 확인한다.
- ⚠️ **`docker compose down -v` 금지** — `caddy_data` 볼륨을 지우면 인증서를 재발급받아야 한다.

---

## 배포 전 보안 체크리스트

- [ ] `AI_ENC_KEY`를 `SECRET_KEY`와 **다른 값**으로 설정 (①)
- [ ] `SESSION_COOKIE_SECURE=true` + Caddy HTTPS 동작 (②)
- [ ] RDS public 차단 + 보안그룹 EC2 한정 + `DB_SSL_CA` 설정 (③)
- [ ] `.env`는 git·이미지에 포함 금지(`.dockerignore`·`.gitignore` 확인)
- [ ] `SMTP_HOST/SMTP_USER/SMTP_PASSWORD` 설정(회원가입 이메일 인증·비밀번호 찾기 코드 발송). 미설정 시 프로덕션에선 발송이 실패한다(mailer fail-closed) — 인증/복구 흐름이 SMTP에 의존
- [ ] (소셜 사용 시) 프로바이더 콘솔의 redirect_uri 등록 목록에 개발·스테이징 URI 가 남아있지 않은지 — 남으면 그게 오픈 리다이렉트다

## 아직 안 한 것 (배포 후/별도)

- AWS 프리티어 개편(신규 계정 6개월 크레딧) — 6개월 후 계정 만료 시 데모 URL 소멸 대비 재배포 계획
