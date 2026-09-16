"""
LottoPro draws.json 생성기 (고속 병렬 처리)
동행복권 API에서 최근 3년치 당첨번호를 수집해 draws.json으로 저장
"""
import requests, json, time, math, sys
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding='utf-8')

LOTTO_API = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo="
PROXIES = [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?",
]

def fetch_draw(drw_no):
    url = LOTTO_API + str(drw_no)
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    # 직접 호출
    try:
        r = requests.get(url, headers=headers, timeout=3)
        d = r.json()
        if d.get("returnValue") == "success":
            return drw_no, d
    except:
        pass
    
    # 프록시
    for proxy in PROXIES:
        try:
            r = requests.get(proxy + requests.utils.quote(url), headers=headers, timeout=5)
            d = r.json()
            if d.get("returnValue") == "success":
                return drw_no, d
        except:
            pass
    return drw_no, None

def estimate_latest():
    start = datetime(2002, 12, 7)
    now = datetime.now()
    return math.floor((now - start).days / 7) + 1

def main():
    latest = estimate_latest()
    years = 3
    from_draw = max(1, latest - (years * 52))
    total_count = latest - from_draw + 1
    print(f"수집 범위: {from_draw}회 ~ {latest}회 (총 {total_count}개)", flush=True)

    draws = {}
    failed = []

    # 병렬 처리
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(fetch_draw, no): no for no in range(from_draw, latest + 1)}
        done_count = 0
        for future in as_completed(futures):
            drw_no, data = future.result()
            done_count += 1
            if data:
                draws[drw_no] = {
                    "drwNo": data["drwNo"],
                    "date": data["drwNoDate"],
                    "nums": [
                        data["drwtNo1"], data["drwtNo2"], data["drwtNo3"],
                        data["drwtNo4"], data["drwtNo5"], data["drwtNo6"]
                    ],
                    "bonus": data["bnusNo"]
                }
                if done_count % 10 == 0:
                    print(f"[{done_count}/{total_count}] {drw_no}회 수집 완료", flush=True)
            else:
                failed.append(drw_no)
                print(f"[FAIL] {drw_no}회 실패", flush=True)

    # 출력용 데이터
    output = {
        "meta": {
            "lastUpdated": datetime.now().isoformat(),
            "totalDraws": len(draws),
            "fromDraw": from_draw,
            "latestDraw": latest,
            "failed": failed
        },
        "draws": dict(sorted(draws.items()))
    }

    with open("F:\\Antigravity\\[APP]\\LottoPro\\draws.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n완료: {len(draws)}개 저장, {len(failed)}개 실패", flush=True)
    print(f"저장 경로: F:\\Antigravity\\[APP]\\LottoPro\\draws.json", flush=True)

if __name__ == "__main__":
    main()
