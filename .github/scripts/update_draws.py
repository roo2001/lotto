"""
GitHub Actions용 자동 업데이트 스크립트
draws.json을 읽고 최신 회차만 추가 저장
"""
import requests, json, math, time
from datetime import datetime
from pathlib import Path

LOTTO_API = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo="

def fetch_draw(drw_no):
    url = LOTTO_API + str(drw_no)
    try:
        r = requests.get(url, timeout=8)
        d = r.json()
        if d.get("returnValue") == "success":
            return d
    except:
        pass
    return None

def estimate_latest():
    start = datetime(2002, 12, 7)
    return math.floor((datetime.now() - start).days / 7) + 1

def main():
    draws_path = Path("draws.json")
    if draws_path.exists():
        with open(draws_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        draws = data.get("draws", {})
        # key를 int로 변환
        draws = {int(k): v for k, v in draws.items()}
    else:
        draws = {}

    latest = estimate_latest()
    existing_max = max(draws.keys()) if draws else 0
    from_draw = existing_max + 1

    print(f"기존 최신 회차: {existing_max}, 현재 추정 최신: {latest}")
    print(f"추가 수집 범위: {from_draw} ~ {latest}")

    added = 0
    for drw_no in range(from_draw, latest + 1):
        d = fetch_draw(drw_no)
        if d:
            draws[drw_no] = {
                "drwNo": d["drwNo"],
                "date": d["drwNoDate"],
                "nums": [d["drwtNo1"], d["drwtNo2"], d["drwtNo3"],
                         d["drwtNo4"], d["drwtNo5"], d["drwtNo6"]],
                "bonus": d["bnusNo"]
            }
            print(f"[OK] {drw_no}회 {draws[drw_no]['date']}: {draws[drw_no]['nums']}")
            added += 1
        else:
            print(f"[SKIP] {drw_no}회 - 아직 추첨 전 또는 실패")
        time.sleep(0.5)

    output = {
        "meta": {
            "lastUpdated": datetime.now().isoformat(),
            "totalDraws": len(draws),
            "latestDraw": max(draws.keys()) if draws else 0
        },
        "draws": draws
    }

    with open(draws_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    print(f"\n완료: {added}개 추가, 총 {len(draws)}개")

if __name__ == "__main__":
    main()
