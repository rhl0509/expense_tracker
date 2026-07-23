"""
tools/curate_merchant_catalog.py — 전역 가맹점 카탈로그 선큐레이션 도구.

로컬 LLM으로 가맹점을 **기본 10 카테고리**로 분류해, 검수용 표(.md)와 적재용 시드
(seeds/merchant_catalog.sql)를 만든다. **DB에는 쓰지 않는다** — rho가 .md 를 검수한 뒤
시드 SQL 을 직접 적용한다(migrations/013 주석의 "선큐레이션만" 정책).

왜 기본 10 카테고리로만 분류하나:
    전역 카탈로그는 모든 사용자가 공유한다. 신규 가입자는 전부 기본 10 카테고리로
    시작하므로(routes/auth._DEFAULT_CATEGORIES), 전역 값도 그 목록이어야 보편적이다.
    rho 장부의 커스텀 카테고리(외식·배달·술·주유…)로 분류하면 남의 장부엔 안 맞는다.

실행 (반드시 로컬 추론 서버가 떠 있어야 함):
    LOCAL_LLM_URL 을 .env 에 설정하고
    PYTHONIOENCODING=utf-8 .venv64\\Scripts\\python.exe tools\\curate_merchant_catalog.py [옵션]

옵션:
    --mode franchise   전국 프랜차이즈만 브랜드 단위로 뽑음(기본). 전역 카탈로그는
                       공유 자산이라 지역 개별 상호·결제대행은 제외하고 지점명을 벗긴다.
    --mode flat        가맹점명 그대로 카테고리만(디버그용). 브랜드 정규화 안 함.
    --source db        현 DB의 '기타' 거래 가맹점을 대상으로(기본)
    --source -         stdin 에서 가맹점명을 줄단위로 읽음
    --book <id>        --source db 일 때 읽을 장부(기본 2)
    --limit <n>        대상 가맹점 수 상한(기본 무제한)
    --chunk <n>        배치 크기(기본 25)
    --out-md <path>    검수표 출력 경로(기본 tools/out/catalog_review.md)
    --out-sql <path>   시드 SQL 출력 경로(기본 seeds/merchant_catalog.sql)
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config                                    # noqa: E402
from database.db_connection import get_db_connection         # noqa: E402
import routes.expense_ai as ai                               # noqa: E402
from merchant_classifier import normalize_merchant           # noqa: E402

# 전역 카탈로그가 채택하는 유일한 카테고리 집합. routes/auth._DEFAULT_CATEGORIES 의
# 지출 항목과 일치해야 한다 — 신규 가입자가 갖는 카테고리가 이것이기 때문이다.
BASE_CATEGORIES = ["저축", "기타", "취미/문화", "쇼핑", "교통비",
                   "식비", "의료", "통신", "구독", "세금/공과금"]


def _load_from_db(book_id, limit):
    conn = get_db_connection()
    try:
        with conn.cursor() as c:
            c.execute(
                """SELECT t.title AS merchant, COUNT(*) AS cnt
                   FROM transactions t JOIN categories cat ON t.category_id = cat.id
                   WHERE t.type='expense' AND cat.name='기타' AND t.account_book_id=%s
                         AND t.title IS NOT NULL AND t.title <> ''
                   GROUP BY t.title ORDER BY COUNT(*) DESC""",
                (book_id,),
            )
            rows = c.fetchall()
    finally:
        conn.close()
    if limit:
        rows = rows[:limit]
    return [(r["merchant"], int(r["cnt"])) for r in rows]


def _load_from_stdin(limit):
    seen, out = set(), []
    for line in sys.stdin:
        m = line.strip()
        if m and m not in seen:
            seen.add(m)
            out.append((m, 0))
            if limit and len(out) >= limit:
                break
    return out


def _sql_escape(s):
    return s.replace("\\", "\\\\").replace("'", "''")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["franchise", "flat"], default="franchise")
    p.add_argument("--source", default="db")
    p.add_argument("--book", type=int, default=2)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--chunk", type=int, default=25)
    p.add_argument("--out-md", default=os.path.join("tools", "out", "catalog_review.md"))
    p.add_argument("--out-sql", default=os.path.join("seeds", "merchant_catalog.sql"))
    args = p.parse_args()

    if not Config.local_llm_enabled():
        sys.exit("LOCAL_LLM_URL 이 설정돼 있지 않습니다. .env 에 로컬 추론 서버 주소를 넣으세요.")

    # 이 도구는 전적으로 로컬 모델만 쓴다 — 저장된 사용자 키를 읽지 않는다.
    ai._load_ai_credential = lambda member_id: ("local", "")

    targets = _load_from_db(args.book, args.limit) if args.source == "db" else _load_from_stdin(args.limit)
    if not targets:
        sys.exit("대상 가맹점이 없습니다.")
    merchants = [m for m, _ in targets]
    cnt_of = dict(targets)
    print(f"모델 {Config.LOCAL_LLM_MODEL} | 모드 {args.mode} | 대상 {len(merchants)}개", flush=True)

    # franchise: {가맹점: (brand, category)}  /  flat: {가맹점: category}
    raw = {}
    t0 = time.time()
    for i in range(0, len(merchants), args.chunk):
        batch = merchants[i:i + args.chunk]
        try:
            if args.mode == "franchise":
                raw.update(ai.classify_franchises_for_member(0, batch, BASE_CATEGORIES))
            else:
                raw.update(ai.classify_merchants_for_member(0, batch, BASE_CATEGORIES))
        except Exception as e:
            print(f"  배치 {i//args.chunk+1} 실패: {e}", flush=True)
        print(f"  배치 {i//args.chunk+1}/{-(-len(merchants)//args.chunk)} "
              f"({time.time()-t0:.0f}s)", flush=True)

    # 두 모드를 공통 형태로 정규화: {가맹점: (key_source, category)}
    #   franchise → key_source=brand(지점명 벗긴 브랜드)
    #   flat      → key_source=가맹점명 그대로
    base = set(BASE_CATEGORIES)
    curated, rejected = {}, {}
    if args.mode == "franchise":
        # classify_franchises 가 이미 SKIP·화이트리스트밖을 걸러 (brand, category)만 준다.
        curated = {m: v for m, v in raw.items() if v[1] != "기타"}
        skipped = [m for m in merchants if m not in raw]     # SKIP 처리된 개별 상호
    else:
        for m, cat in raw.items():
            if cat in base and cat != "기타":
                curated[m] = (m, cat)
            elif cat not in base:
                rejected[m] = cat
        skipped = []
    missing = [m for m in merchants if m not in raw and m not in skipped]

    # ── 브랜드 단위 병합 ──
    # 여러 가맹점(이디야수원호매실점·이디야강남점)이 같은 브랜드로 정규화되면 카탈로그엔
    # 브랜드 하나만 들어간다. 건수는 합산, 원본 가맹점명은 검수용으로 모아 둔다.
    # 같은 브랜드가 다른 카테고리로 오면 다수결(동률이면 거래수 큰 쪽)로 하나만 남긴다.
    brands = {}   # brand_key -> {"brand": 표시명, "cats": {category: 건수}, "sources": [원본...]}
    for merchant, (brand, category) in curated.items():
        bkey = normalize_merchant(brand)
        b = brands.setdefault(bkey, {"brand": brand, "cats": {}, "sources": []})
        b["cats"][category] = b["cats"].get(category, 0) + cnt_of.get(merchant, 0) + 1
        b["sources"].append(merchant)
    for b in brands.values():
        b["category"] = max(b["cats"].items(), key=lambda kv: kv[1])[0]
        b["count"] = sum(cnt_of.get(m, 0) for m in b["sources"])

    # ── 검수표(.md) — DB 무변경, 사람이 품질 판단 ──
    dist = {}
    for b in brands.values():
        dist[b["category"]] = dist.get(b["category"], 0) + 1
    md = [
        "# 전역 카탈로그 선큐레이션 검수표 (DB 무변경)", "",
        f"- 모델: `{Config.LOCAL_LLM_MODEL}` · 모드 `{args.mode}`",
        f"- 대상 가맹점: {len(merchants)} · 소요 {time.time()-t0:.0f}s",
        f"- **브랜드 {len(brands)}개** (프랜차이즈로 채택) · SKIP(개별상호·결제대행) {len(skipped)} "
        f"· 화이트리스트탈락 {len(rejected)} · 무응답 {len(missing)}", "",
        "> 지점명을 벗긴 브랜드 단위다. 같은 브랜드의 여러 지점은 한 행으로 합쳐졌다.", "",
        "## 카테고리 분포", "", "| 카테고리 | 브랜드 수 |", "|---|---:|",
        *[f"| {k} | {v} |" for k, v in sorted(dist.items(), key=lambda x: -x[1])], "",
        "## 카탈로그 제안 (브랜드 → 카테고리)", "",
        "| 브랜드 | 거래수 | 제안 | 합쳐진 원본 가맹점 |", "|---|---:|---|---|",
        *[f"| {b['brand']} | {b['count']} | **{b['category']}** | {', '.join(sorted(set(b['sources']))[:4])}"
          f"{' …' if len(set(b['sources']))>4 else ''} |"
          for b in sorted(brands.values(), key=lambda x: -x["count"])],
    ]
    if rejected:
        md += ["", "## 화이트리스트 탈락 (버려짐 · 시드 제외)", "", "| 가맹점 | 모델 출력 |", "|---|---|",
               *[f"| {m} | `{v}` |" for m, v in rejected.items()]]
    if skipped:
        md += ["", f"## SKIP — 개별 상호·결제대행 ({len(skipped)}건, 전역 제외)", "",
               "> 지역 개별 상점과 결제대행은 전역 카탈로그에 넣지 않는다(다른 사용자에게 무용 + 프라이버시).", "",
               *[f"- {m}" for m in skipped]]
    if missing:
        md += ["", "## 무응답", "", *[f"- {m}" for m in missing]]

    os.makedirs(os.path.dirname(args.out_md), exist_ok=True)
    open(args.out_md, "w", encoding="utf-8").write("\n".join(md))

    # ── 시드 SQL — rho 검수 후 명시 적용. 키는 브랜드 정규화값. ──
    lines = [
        "-- seeds/merchant_catalog.sql — 전역 가맹점 카탈로그 시드 (선큐레이션 결과).",
        "-- tools/curate_merchant_catalog.py 가 생성. **검수 후** 적용할 것.",
        "-- merchant_key 는 브랜드 정규화값(지점명 벗김). 전국 프랜차이즈만 담는다.",
        "-- 적용: mysql ... < seeds/merchant_catalog.sql  (migrations/013 이후)",
        "-- 재적용 안전(ON DUPLICATE KEY UPDATE).",
        "",
    ]
    for bkey in sorted(brands):
        b = brands[bkey]
        lines.append(
            f"INSERT INTO merchant_catalog (merchant_key, category_name, source) "
            f"VALUES ('{_sql_escape(bkey)}', '{_sql_escape(b['category'])}', 'curated') "
            f"ON DUPLICATE KEY UPDATE category_name=VALUES(category_name);"
        )
    os.makedirs(os.path.dirname(args.out_sql), exist_ok=True)
    open(args.out_sql, "w", encoding="utf-8").write("\n".join(lines) + "\n")

    print(f"\n검수표: {args.out_md}")
    print(f"시드  : {args.out_sql}  (브랜드 {len(brands)}개)")
    print("→ 검수표를 확인한 뒤 시드를 DB에 적용하세요. 이 도구는 DB를 쓰지 않았습니다.")


if __name__ == "__main__":
    main()
