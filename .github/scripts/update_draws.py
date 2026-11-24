"""
GitHub Actions 및 로컬 공용 로또 6/45 전체 회차 자동 업데이트 스크립트
- 1차 소스: smok95.github.io/lotto/results/all.json (1회차~최신 전체 실측 데이터)
- 2차 보충: smok95 개별 회차 JSON -> 동행복권 공식 API 폴백
- 저장 형식: draws.json (1회차부터 최신 회차까지 중복 없이 압축 저장)
"""
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
import requests

SMOK_ALL_URL = "https://smok95.github.io/lotto/results/all.json"
SMOK_ONE_URL = "https://smok95.github.io/lotto/results/{drw_no}.json"
DHLOTTERY_URL = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo={drw_no}"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; LottoProUpdater/4.0)"}


def estimate_latest():
    start = datetime(2002, 12, 7)
    return math.floor((datetime.now() - start).days / 7) + 1


def normalize_smok(d):
    if not d or "draw_no" not in d or "numbers" not in d:
        return None
    nums = sorted(int(x) for x in d["numbers"])
    if len(nums) != 6:
        return None
    return {
        "drwNo": int(d["draw_no"]),
        "date": str(d.get("date", ""))[:10],
        "nums": nums,
        "bonus": int(d.get("bonus_no", 0)),
    }


def fetch_smok_all():
    try:
        r = requests.get(SMOK_ALL_URL, headers=HEADERS, timeout=20)
        if r.status_code == 200:
            items = r.json()
            if isinstance(items, list) and len(items) > 1000:
                parsed = {}
                for item in items:
                    rec = normalize_smok(item)
                    if rec:
                        parsed[rec["drwNo"]] = rec
                return parsed
    except Exception as e:
        print(f"[WARN] smok95 all.json 조회 실패: {e}")
    return {}


def fetch_single_draw(drw_no):
    # 1차: smok95 개별 JSON
    try:
        r = requests.get(SMOK_ONE_URL.format(drw_no=drw_no), headers=HEADERS, timeout=8)
        if r.status_code == 200:
            rec = normalize_smok(r.json())
            if rec:
                return rec
    except Exception:
        pass

    # 2차: 동행복권 공식 API 폴백
    try:
        r = requests.get(DHLOTTERY_URL.format(drw_no=drw_no), headers=HEADERS, timeout=8)
        if r.status_code == 200:
            d = r.json()
            if d.get("returnValue") == "success":
                nums = sorted(int(d[f"drwtNo{i}"]) for i in range(1, 7))
                return {
                    "drwNo": int(d["drwNo"]),
                    "date": str(d["drwNoDate"]),
                    "nums": nums,
                    "bonus": int(d["bnusNo"]),
                }
    except Exception:
        pass

    return None


def main():
    root = Path(__file__).resolve().parents[2]
    draws_path = root / "draws.json"
    if not draws_path.exists():
        draws_path = Path("draws.json")

    draws = {}
    if draws_path.exists():
        with open(draws_path, "r", encoding="utf-8") as f:
            old = json.load(f)
        for k, v in old.get("draws", {}).items():
            draws[int(k)] = v

    before_count = len(draws)
    before_max = max(draws.keys()) if draws else 0

    # 1단계: smok95 전체 회차 일괄 동기화 (1회차 ~ 최신)
    bulk = fetch_smok_all()
    if bulk:
        draws.update(bulk)
        print(f"[OK] smok95 all.json 로드: {len(bulk)}개 회차 (최신 {max(bulk.keys())}회)")

    # 2단계: 추정 최신 회차까지 누락분 개별 보충
    est_latest = estimate_latest()
    cur_max = max(draws.keys()) if draws else 0
    extra_added = 0
    for drw_no in range(cur_max + 1, est_latest + 1):
        rec = fetch_single_draw(drw_no)
        if rec:
            draws[drw_no] = rec
            extra_added += 1
            print(f"[OK] 개별 보충 {drw_no}회 ({rec['date']}): {rec['nums']}")
        else:
            print(f"[SKIP] {drw_no}회 아직 미공개 또는 조회 실패")
        time.sleep(0.3)

    if not draws:
        print("[ERROR] 수집된 데이터가 없습니다.")
        raise SystemExit(1)

    sorted_keys = sorted(draws.keys())
    ordered_draws = {str(k): draws[k] for k in sorted_keys}

    output = {
        "meta": {
            "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "totalDraws": len(sorted_keys),
            "fromDraw": sorted_keys[0],
            "latestDraw": sorted_keys[-1],
        },
        "draws": ordered_draws,
    }

    with open(draws_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = draws_path.stat().st_size / 1024
    print(
        f"[DONE] 저장 완료: {sorted_keys[0]}~{sorted_keys[-1]}회 "
        f"(총 {len(sorted_keys)}개, 기존 {before_count}개/최신 {before_max}회 -> +{extra_added}개 보충, {size_kb:.1f} KB)"
    )


if __name__ == "__main__":
    main()
