/**
 * LottoPro v4.0 Combinatorial Covering Design (Wheeling System) Engine
 * - 풀 휠 (Full Wheel): 선택한 N개 번호의 모든 6개 조합
 * - 축약 휠 (Abbreviated Wheel):
 *     * 4등 보장 (4-if-6): N개 중 당첨 6개 포함 시 최소 1게임 4개 일치 100% 수학적 보장
 *     * 5등 보장 (3-if-6): N개 중 당첨 6개 포함 시 최소 1게임 3개 일치 100% 수학적 보장
 * - 15비트 정수 비트마스크 기반 고속 Greedy Set Cover + 중복 블록 제거(Pruning) + 전수 검증(100% Proof)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LottoWheels = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function comb(n, k) {
    if (k > n || k < 0) return 0;
    if (k === 0 || k === n) return 1;
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return Math.round(r);
  }

  // 16비트 이하 비트마스크의 1비트 개수 (popcount)
  function popcount(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }

  // 0..n-1 인덱스 중 k개를 고르는 모든 비트마스크 배열 생성
  function generateMasks(n, k) {
    const out = [];
    function dfs(start, chosen, mask) {
      if (chosen === k) {
        out.push(mask);
        return;
      }
      const limit = n - (k - chosen);
      for (let i = start; i <= limit; i++) {
        dfs(i + 1, chosen + 1, mask | (1 << i));
      }
    }
    dfs(0, 0, 0);
    return out;
  }

  function maskToNumbers(mask, sortedNums) {
    const res = [];
    for (let i = 0; i < sortedNums.length; i++) {
      if ((mask & (1 << i)) !== 0) res.push(sortedNums[i]);
    }
    return res;
  }

  // 풀 휠 (N <= 10 권장)
  function generateFullWheel(nums) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const n = sorted.length;
    if (n < 6 || n > 10) {
      return { error: '풀 휠은 6~10개 번호까지 지원합니다.', tickets: [] };
    }
    const masks = generateMasks(n, 6);
    const tickets = masks.map(m => maskToNumbers(m, sorted));
    return {
      mode: 'full',
      guarantee: 6,
      selectedCount: n,
      fullCount: masks.length,
      ticketCount: tickets.length,
      savingsPct: 0,
      verified: { totalCases: masks.length, coveredCases: masks.length, coveragePct: 100 },
      tickets
    };
  }

  // 축약 커버링 휠 생성 + 중복 제거 + 100% 전수 검증
  // guarantee: 4 (4-if-6, N=7..12) 또는 3 (3-if-6, N=7..15)
  function generateAbbreviatedWheel(nums, guarantee, scoreFn) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const n = sorted.length;
    if (n < 7) {
      return { error: '축약 휠은 최소 7개 번호를 선택해야 합니다.', tickets: [] };
    }
    if (guarantee === 4 && n > 12) {
      return { error: '4등 보장(4-if-6) 축약 휠은 빠른 모바일 연산을 위해 최대 12개까지 지원합니다.', tickets: [] };
    }
    if (guarantee === 3 && n > 15) {
      return { error: '5등 보장(3-if-6) 축약 휠은 최대 15개까지 지원합니다.', tickets: [] };
    }

    const allSubsets = generateMasks(n, 6);
    const totalSubsets = allSubsets.length;

    // 후보 티켓 풀 (N <= 12면 전체 6-조합, N=13..15는 균등 간격 표본 + 미커버 집중 보충)
    let candidates = allSubsets;
    if (n > 12) {
      const step = Math.max(1, Math.floor(totalSubsets / 420));
      candidates = [];
      for (let i = 0; i < totalSubsets; i += step) candidates.push(allSubsets[i]);
    }

    // 동점 시 품질(패턴/EV) 우대용 캐시
    const qualityCache = new Map();
    function getQuality(mask) {
      if (!scoreFn) return 0;
      if (!qualityCache.has(mask)) {
        qualityCache.set(mask, scoreFn(maskToNumbers(mask, sorted)));
      }
      return qualityCache.get(mask);
    }

    // 미커버 인덱스 집합 관리
    let uncovered = new Int32Array(totalSubsets);
    for (let i = 0; i < totalSubsets; i++) uncovered[i] = i;
    let uncLen = totalSubsets;

    const chosenMasks = [];
    const chosenSet = new Set();

    while (uncLen > 0) {
      let bestMask = -1;
      let bestCover = -1;
      let bestQual = -1;

      // 미커버 개수가 적어지면 첫 미커버 자체도 후보에 포함해 100% 수렴 보장
      const pool = uncLen < 60 && n > 12
        ? [allSubsets[uncovered[0]], ...candidates]
        : candidates;

      for (let c = 0; c < pool.length; c++) {
        const cand = pool[c];
        if (chosenSet.has(cand)) continue;
        let cover = 0;
        for (let u = 0; u < uncLen; u++) {
          if (popcount(cand & allSubsets[uncovered[u]]) >= guarantee) {
            cover++;
          }
        }
        if (cover > bestCover) {
          bestCover = cover;
          bestMask = cand;
          bestQual = getQuality(cand);
        } else if (cover === bestCover && cover > 0 && scoreFn) {
          const q = getQuality(cand);
          if (q > bestQual) {
            bestMask = cand;
            bestQual = q;
          }
        }
      }

      if (bestMask === -1 || bestCover <= 0) {
        bestMask = allSubsets[uncovered[0]];
      }

      chosenMasks.push(bestMask);
      chosenSet.add(bestMask);

      // 미커버 목록 압축
      let nextLen = 0;
      for (let u = 0; u < uncLen; u++) {
        const subIdx = uncovered[u];
        if (popcount(bestMask & allSubsets[subIdx]) < guarantee) {
          uncovered[nextLen++] = subIdx;
        }
      }
      uncLen = nextLen;
    }

    // 2단계: 중복 블록 제거 (Pruning) — 빼도 100% 커버되는 불필요 티켓 제거
    let pruned = true;
    while (pruned && chosenMasks.length > 1) {
      pruned = false;
      for (let removeIdx = chosenMasks.length - 1; removeIdx >= 0; removeIdx--) {
        let allCovered = true;
        for (let s = 0; s < totalSubsets; s++) {
          const sub = allSubsets[s];
          let ok = false;
          for (let k = 0; k < chosenMasks.length; k++) {
            if (k === removeIdx) continue;
            if (popcount(chosenMasks[k] & sub) >= guarantee) {
              ok = true;
              break;
            }
          }
          if (!ok) { allCovered = false; break; }
        }
        if (allCovered) {
          chosenMasks.splice(removeIdx, 1);
          pruned = true;
          break;
        }
      }
    }

    // 3단계: 전체 경우의 수(C(N,6)) 100% 수학적 검증
    let coveredCases = 0;
    for (let s = 0; s < totalSubsets; s++) {
      const sub = allSubsets[s];
      for (let k = 0; k < chosenMasks.length; k++) {
        if (popcount(chosenMasks[k] & sub) >= guarantee) {
          coveredCases++;
          break;
        }
      }
    }

    const tickets = chosenMasks.map(m => maskToNumbers(m, sorted));
    const savingsPct = Number((((totalSubsets - tickets.length) / totalSubsets) * 100).toFixed(1));

    return {
      mode: guarantee === 4 ? 'abbr4' : 'abbr3',
      guarantee,
      selectedCount: n,
      fullCount: totalSubsets,
      ticketCount: tickets.length,
      savingsPct,
      verified: {
        totalCases: totalSubsets,
        coveredCases,
        coveragePct: Number(((coveredCases / totalSubsets) * 100).toFixed(2))
      },
      tickets
    };
  }

  return {
    comb,
    generateFullWheel,
    generateAbbreviatedWheel
  };
});

