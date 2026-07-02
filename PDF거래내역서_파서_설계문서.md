# PDF 거래내역서 파서 — 기능 설계 문서

> 카드사·증권사에서 받은 PDF 명세서를 업로드하면 표를 인식해
> 거래 데이터를 통째로 추출하여 **가계부 / 주식 프로그램**에 자동 입력한다.
>
> **이 프로젝트의 1차 목적은 "PDF 표 추출" 이라는 실무 기술의 학습.**
> 실용성(대량 거래 일괄 입력)은 부차적 보상이다.

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| 입력 | 카드 명세서 PDF, 증권 거래내역 PDF |
| 출력 | 정규화된 거래 데이터 → 가계부(지출) / 주식(매매내역) |
| 핵심 기술 | PDF 표 추출(pdfplumber, camelot), 텍스트 파싱, 정규화 |
| 확장 기술 | 스캔 PDF 대응(OCR), 포맷 자동 감지 |
| 처리 모델 | 추출 → **사용자 검수** → 확정 (자동 입력 아님) |

> **왜 검수 단계가 필수인가:** PDF 파싱은 절대 100% 정확하지 않다.
> 금액 한 자리 오인식이 가계부 전체를 틀어지게 하므로, 추출 결과를
> 사용자가 확인·수정한 뒤 확정하는 흐름이 현실적이다.

---

## 2. 학습 목표 (이 프로젝트의 진짜 목적)

단계별로 난이도가 올라가는 학습 거리가 한 프로젝트에 쌓여 있다.

1. **PDF 구조 이해** — PDF는 "텍스트를 좌표에 찍어둔 것"이지 표가 아니다.
   사람 눈에 표로 보이는 것을 코드로 복원하는 게 핵심 난제.
2. **표 추출 두 방식** — 격자선 기반(lattice) vs 공백 정렬 기반(stream).
   같은 PDF라도 어떤 방식을 쓰느냐에 따라 결과가 천차만별.
3. **텍스트 정규화** — 금액(`1,234,500원`), 날짜(`2026.03.15` / `26/03/15`),
   통화(KRW/USD) 같은 제각각 포맷을 표준형으로 변환.
4. **포맷 다형성 대응** — 카드사·증권사마다 레이아웃이 다름.
   하드코딩 → 어댑터 패턴 → (확장)자동 감지로 발전시키는 설계 경험.
5. **(확장) 스캔 PDF + OCR** — 이미지로 된 PDF는 텍스트 추출이 안 됨.
   `pdf2image` + OCR 경로를 별도로 태우는 분기 처리.

---

## 3. 핵심 난제 — PDF 표 추출이 어려운 이유

이 섹션이 학습의 핵심이다. 막연히 "라이브러리 쓰면 되겠지" 하면 막힌다.

### 3-1. PDF에는 "표"라는 개념이 없다
PDF 내부는 "이 글자를 (x, y) 좌표에 그려라"의 나열일 뿐이다.
우리가 보는 표의 행·열은 글자들의 좌표 정렬로 *추측*해야 한다.

### 3-2. 텍스트 PDF vs 스캔 PDF
- **텍스트 PDF**: 글자 데이터가 들어있음 → pdfplumber/camelot로 추출 가능
- **스캔 PDF**: 종이를 찍은 이미지일 뿐 → 텍스트가 없음 → **OCR 필요**
- 첫 단계에서 반드시 둘을 판별해 경로를 나눠야 한다.

### 3-3. lattice vs stream
- **lattice(격자형)**: 표에 실제 선이 그려진 경우. 선을 기준으로 칸 분리.
  camelot의 `flavor='lattice'` 가 강함.
- **stream(공백정렬형)**: 선 없이 공백으로 줄맞춤된 경우. 좌표 군집으로 추정.
  camelot `flavor='stream'`, 또는 pdfplumber의 컬럼 추정.
- 카드 명세서는 stream, 증권 거래내역은 lattice인 경우가 많다(절대적이진 않음).

### 3-4. 멀티페이지·반복 헤더
거래가 여러 페이지에 걸치면 페이지마다 헤더가 반복된다.
헤더 행을 식별해 제거하고 데이터 행만 이어붙여야 한다.

### 3-5. 한글 인코딩·줄바꿈
가맹점명이 길어 셀 안에서 줄바꿈되거나, 한글이 깨지는 경우 처리 필요.

---

## 4. 처리 흐름

```
[1] PDF 업로드
        ↓
[2] PDF 타입 판별 (텍스트 추출 가능?)
     ├─ 텍스트 PDF → [3a]
     └─ 스캔 PDF  → [3b] OCR 경로 (확장 단계)
        ↓
[3a] 표 추출 (pdfplumber 1차 → 실패 시 camelot lattice/stream)
        ↓
[4] 포맷 감지 → 해당 카드사/증권사 파서(어댑터) 선택
        ↓
[5] 정규화 (날짜·금액·통화·카테고리 표준화)
        ↓
[6] staging 테이블에 저장 (검수 대기 상태)
        ↓
[7] 사용자 검수 화면에서 확인·수정
        ↓
[8] 확정 → 기존 가계부 / 주식 DB 로 이관
```

---

## 5. 기술 스택

- **백엔드**: FastAPI (PDF 업로드 엔드포인트 + 파싱 처리)
- **PDF 파싱**: `pdfplumber` (1차), `camelot-py[cv]` (표 전용 2차)
- **보조**: `pandas` (추출 결과 정형화)
- **DB**: MySQL (staging → 확정 이관)
- **프론트**: Next.js (업로드 + 검수 테이블 UI)
- **확장(스캔 PDF)**: `pdf2image` + `PaddleOCR`/`Tesseract`

```bash
pip install pdfplumber camelot-py[cv] pandas
# camelot 은 Ghostscript 의존 → 시스템에 별도 설치 필요
#   Ubuntu: sudo apt-get install ghostscript python3-tk
```

> **참고:** camelot은 Ghostscript와 OpenCV에 의존해 설치가 까다롭다.
> 먼저 pdfplumber만으로 시작하고, 격자형 표에서 한계를 느낄 때
> camelot을 도입하는 순서를 권장한다.

---

## 6. DB 스키마 (MySQL)

```sql
-- 업로드/처리 작업 단위
CREATE TABLE IF NOT EXISTS import_jobs (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    file_name    VARCHAR(255) NOT NULL,
    issuer       VARCHAR(50)  NULL,            -- 감지된 카드사/증권사
    doc_type     ENUM('card','securities') NOT NULL,
    pdf_type     ENUM('text','scanned') NULL,  -- 텍스트/스캔 판별 결과
    status       ENUM('parsing','review','done','failed') NOT NULL DEFAULT 'parsing',
    row_count    INT NOT NULL DEFAULT 0,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 추출된 거래 (검수 전 임시 보관)
CREATE TABLE IF NOT EXISTS staging_transactions (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id       BIGINT NOT NULL,
    txn_date     DATE NULL,
    merchant     VARCHAR(255) NULL,            -- 가맹점/종목명
    amount       DECIMAL(18,2) NULL,
    currency     VARCHAR(3) NOT NULL DEFAULT 'KRW',
    category     VARCHAR(50) NULL,             -- 자동 분류 결과(선택)
    raw_text     TEXT NULL,                    -- 원본 행(디버깅·재파싱용)
    is_confirmed TINYINT(1) NOT NULL DEFAULT 0,
    KEY idx_job (job_id),
    CONSTRAINT fk_job FOREIGN KEY (job_id) REFERENCES import_jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> `raw_text` 컬럼이 학습·디버깅에 핵심이다. 파싱이 틀렸을 때
> 원본 행과 비교해 파서를 개선할 수 있다.

---

## 7. 핵심 모듈 코드

### 7-1. PDF 타입 판별

```python
import pdfplumber

def detect_pdf_type(path: str) -> str:
    """텍스트가 거의 없으면 스캔 PDF로 판정."""
    with pdfplumber.open(path) as pdf:
        text = (pdf.pages[0].extract_text() or "").strip()
    return "text" if len(text) > 30 else "scanned"
```

### 7-2. 표 추출 (pdfplumber 기본)

```python
import pdfplumber

def extract_rows(path: str) -> list[list[str]]:
    """모든 페이지의 표를 행 리스트로 추출."""
    rows: list[list[str]] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    cleaned = [(c or "").strip() for c in row]
                    if any(cleaned):          # 빈 행 제외
                        rows.append(cleaned)
    return rows
```

### 7-3. 파서 어댑터 (포맷 다형성 대응)

카드사마다 컬럼 순서가 다르므로, 발급사별 파서를 분리한다.
(하드코딩에서 시작해 점차 일반화하는 학습 경로의 핵심)

```python
from abc import ABC, abstractmethod
from datetime import datetime

class StatementParser(ABC):
    """발급사별 파서의 공통 인터페이스."""
    @abstractmethod
    def matches(self, rows: list[list[str]]) -> bool:
        """이 PDF가 해당 발급사 포맷인지 감지."""
    @abstractmethod
    def parse(self, rows: list[list[str]]) -> list[dict]:
        """표준 거래 dict 리스트로 변환."""


class SampleCardParser(StatementParser):
    """예시: 컬럼이 [거래일, 가맹점, 이용금액] 순인 카드."""
    HEADER_KEYS = ("거래일", "가맹점", "이용금액")

    def matches(self, rows):
        header = " ".join(rows[0]) if rows else ""
        return all(k in header for k in self.HEADER_KEYS)

    def parse(self, rows):
        out = []
        for r in rows[1:]:                    # 헤더 제외
            if len(r) < 3:
                continue
            out.append({
                "txn_date": _parse_date(r[0]),
                "merchant": r[1],
                "amount": _parse_amount(r[2]),
                "currency": "KRW",
                "raw_text": " | ".join(r),
            })
        return out


def select_parser(rows: list[list[str]]) -> StatementParser | None:
    """등록된 파서 중 포맷이 맞는 것을 자동 선택."""
    for parser in (SampleCardParser(),):      # 새 카드사 추가 시 여기에 등록
        if parser.matches(rows):
            return parser
    return None
```

### 7-4. 정규화 유틸

```python
import re
from datetime import datetime

def _parse_amount(s: str) -> float | None:
    """'1,234,500원' / '-12,000' → float"""
    if not s:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", s)      # 숫자·점·마이너스만
    try:
        return float(cleaned)
    except ValueError:
        return None

def _parse_date(s: str):
    """'2026.03.15' / '2026-03-15' / '26/03/15' 등 → date"""
    s = s.strip()
    for fmt in ("%Y.%m.%d", "%Y-%m-%d", "%Y/%m/%d", "%y.%m.%d", "%y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None
```

### 7-5. FastAPI 업로드 엔드포인트

```python
from fastapi import APIRouter, UploadFile, File, Depends
import tempfile, shutil

router = APIRouter()

@router.post("/imports/upload")
async def upload_statement(file: UploadFile = File(...),
                           db = Depends(get_db)):
    # 1) 임시 저장
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(file.file, tmp)
        path = tmp.name

    # 2) 타입 판별 → 텍스트 PDF만 우선 처리
    if detect_pdf_type(path) == "scanned":
        return {"status": "failed", "reason": "스캔 PDF는 OCR 단계에서 지원 예정"}

    # 3) 추출 → 파서 선택 → 정규화
    rows = extract_rows(path)
    parser = select_parser(rows)
    if parser is None:
        return {"status": "failed", "reason": "지원하지 않는 명세서 포맷"}
    txns = parser.parse(rows)

    # 4) staging 저장 (검수 대기) — 기존 DB 레이어로 저장
    job_id = save_staging(db, file.filename, txns)
    return {"status": "review", "job_id": job_id, "row_count": len(txns)}
```

---

## 8. 개발 로드맵

| 단계 | 내용 | 학습 포인트 |
|------|------|------------|
| 1단계 | 텍스트 PDF 1종(본인 카드)만 pdfplumber로 추출 | PDF 구조, 표 추출 기본 |
| 2단계 | 정규화 + staging 저장 + 검수 UI | 데이터 정제, 휴먼 인 더 루프 |
| 3단계 | 파서 어댑터로 카드사 2~3종 확장 | 다형성 설계, 포맷 감지 |
| 4단계 | camelot 도입해 격자형(증권 거래내역) 대응 | lattice/stream 차이 |
| 5단계 | (확장) 스캔 PDF + OCR 경로 | pdf2image, OCR, GPU 활용 |
| 6단계 | 확정 거래 → 가계부/주식 DB 이관 | 기존 시스템 통합 |

> **1단계만으로도 "내 카드 명세서가 자동으로 읽힌다"는 성취를 얻는다.**
> 한 종류부터 완성하고, 새 포맷을 만날 때마다 파서를 추가하는 방식이
> 학습·유지보수 모두 유리하다.

---

## 9. 실전 팁

- **본인 PDF부터 시작하라.** 실제 카드 명세서 1장을 놓고 pdfplumber의
  `extract_tables()` 결과를 그대로 출력해보는 게 첫걸음이다.
  생각한 표와 추출 결과가 얼마나 다른지 직접 보는 것이 가장 빠른 학습.
- **`page.extract_table()` 의 settings를 만져보라.** `vertical_strategy`,
  `horizontal_strategy` 를 `"text"` / `"lines"` 로 바꾸면 결과가 크게 달라진다.
- **민감 정보 주의.** 명세서에는 카드번호·계좌번호가 들어있다.
  파싱 후 마스킹하거나, 처리 후 원본 PDF를 즉시 삭제하는 정책을 둘 것.
- **검수를 건너뛰지 마라.** 자동 입력으로 직행하면 오인식 한 건이
  가계부 전체 신뢰도를 무너뜨린다.

---

## 10. 통합 시 참고

- 추출 코드는 순수 함수로 두고, DB 저장·인증은 기존 레이어 재사용
- `staging_transactions` 의 `raw_text` 로 파싱 정확도를 계속 개선
- 카드사 추가는 `StatementParser` 상속 클래스를 만들어 `select_parser` 에 등록만 하면 됨
- 로컬 코드베이스 통합 작업이 많으므로 Claude Code 활용 권장
