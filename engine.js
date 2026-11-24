/**
 * LottoPro v4.0 Core Mathematical & Statistical Engine
 * - 전체 실측 데이터 기반 통계·카이제곱 균등성 검정
 * - 통합 패턴 스코어 (합계·홀짝·고저·구간·연속·AC·샤논 엔트로피·끝수합·이월수)
 * - 7x7 OMR 기하 패턴 및 군집 회피 기댓값(EV) 스코어
 * - 고정수/제외수 반자동 + 포트폴리오 중복 제어 생성기
 * - 역대 전체 회차 백테스트 (통과율 + 무작위 대조군 Walk-Forward 시뮬레이션)
 * - 연관 규칙 리프트(Lift), 마르코프 체인 전이 확률, 몬테카를로 시뮬레이션
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LottoEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 실제 동행복권 OMR 용지(7x7 격자) 기준 좌표
  function toOmrCoord(n) {
    const idx = n - 1;
    return { row: Math.floor(idx / 7), col: idx % 7 };
  }

  // 결정적 난수 생성기 (Mulberry32) — 백테스트 재현성 보장
  function createRng(seed) {
    let s = (seed >>> 0) || 123456789;
    return function () {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 표준 정규 누적분포함수 (Abramowitz & Stegun 7.1.26)
  function normalCdf(z) {
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429;
    const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
    return 0.5 * (1 + sign * erf);
  }

  // 카이제곱 상측 꼬리 확률 근사 (Wilson-Hilferty 변환, df=44에서 매우 정밀)
  function chiSquarePValue(chi2, df) {
    if (chi2 <= 0) return 1.0;
    const k = df;
    const z = (Math.pow(chi2 / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
    return Math.max(0, Math.min(1, 1 - normalCdf(z)));
  }

  // 1~45 실측 출현 빈도 (이중 카운팅 원천 차단: draws 배열에서 직접 계산)
  function calcFrequencies(draws) {
    const freq = {};
    for (let n = 1; n <= 45; n++) freq[n] = 0;
    for (let i = 0; i < draws.length; i++) {
      const nums = draws[i].nums;
      if (!nums || nums.length !== 6) continue;
      for (let j = 0; j < 6; j++) freq[nums[j]]++;
    }
    return freq;
  }

  // 카이제곱 균등성 검정 (df = 44)
  function calcChiSquare(draws, windowSize) {
    const slice = windowSize && windowSize > 0 && windowSize < draws.length
      ? draws.slice(-windowSize)
      : draws;
    const N = slice.length;
    if (N === 0) {
      return { drawsCount: 0, expected: 0, chi2: 0, df: 44, pValue: 1, fair: true, freq: calcFrequencies([]) };
    }
    const freq = calcFrequencies(slice);
    const expected = (N * 6) / 45;
    let chi2 = 0;
    let maxDevNum = 1, minDevNum = 1;
    for (let n = 1; n <= 45; n++) {
      const diff = freq[n] - expected;
      chi2 += (diff * diff) / expected;
      if (freq[n] > freq[maxDevNum]) maxDevNum = n;
      if (freq[n] < freq[minDevNum]) minDevNum = n;
    }
    const pValue = chiSquarePValue(chi2, 44);
    return {
      drawsCount: N,
      expected: Number(expected.toFixed(2)),
      chi2: Number(chi2.toFixed(2)),
      df: 44,
      pValue: Number(pValue.toFixed(4)),
      fair: pValue >= 0.05,
      maxNum: { n: maxDevNum, count: freq[maxDevNum] },
      minNum: { n: minDevNum, count: freq[minDevNum] },
      freq
    };
  }

  // AC값 (Arithmetic Complexity)
  function calcAC(nums) {
    const s = [...nums].sort((a, b) => a - b);
    const diffs = new Set();
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        diffs.add(s[j] - s[i]);
      }
    }
    return diffs.size - (s.length - 1);
  }

  // 샤논 엔트로피 (5개 번호 구간 분포의 분산도, 0 ~ log2(5)≈2.322)
  function calcZoneEntropy(nums) {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      const z = n <= 10 ? 0 : n <= 20 ? 1 : n <= 30 ? 2 : n <= 40 ? 3 : 4;
      counts[z]++;
    }
    let H = 0;
    for (let z = 0; z < 5; z++) {
      if (counts[z] > 0) {
        const p = counts[z] / nums.length;
        H -= p * Math.log2(p);
      }
    }
    return Number(H.toFixed(3));
  }

  // 7x7 OMR 기하 패턴 및 군집 회피(Anti-Crowding) EV 지수 평가
  function evaluateAntiCrowding(nums, context) {
    const sorted = [...nums].sort((a, b) => a - b);
    let evScore = 100;
    const penalties = [];

    // 1. 생일 편향 (1~31번 쏠림)
    const under31 = sorted.filter(n => n <= 31).length;
    const over31 = 6 - under31;
    if (under31 === 6) {
      evScore -= 24;
      penalties.push({ reason: '1~31 생일 구간 6개 집중', delta: -24 });
    } else if (under31 === 5) {
      evScore -= 12;
      penalties.push({ reason: '1~31 생일 구간 5개 편중', delta: -12 });
    } else if (over31 >= 3) {
      penalties.push({ reason: '32~45 고번호 3개 이상 확보 (분할 회피 유리)', delta: 0 });
    }

    // 2. 7x7 OMR 용지 기하 패턴
    const coords = sorted.map(toOmrCoord);
    const rowCnt = {}, colCnt = {}, diag1Cnt = {}, diag2Cnt = {};
    let borderCnt = 0;
    coords.forEach(c => {
      rowCnt[c.row] = (rowCnt[c.row] || 0) + 1;
      colCnt[c.col] = (colCnt[c.col] || 0) + 1;
      const d1 = c.row - c.col;
      const d2 = c.row + c.col;
      diag1Cnt[d1] = (diag1Cnt[d1] || 0) + 1;
      diag2Cnt[d2] = (diag2Cnt[d2] || 0) + 1;
      if (c.row === 0 || c.row === 6 || c.col === 0 || c.col === 6) borderCnt++;
    });

    const maxRow = Math.max(...Object.values(rowCnt));
    const maxCol = Math.max(...Object.values(colCnt));
    const maxDiag = Math.max(...Object.values(diag1Cnt), ...Object.values(diag2Cnt));

    if (maxRow >= 4) {
      evScore -= 22;
      penalties.push({ reason: `OMR 가로 같은 줄 ${maxRow}개 집중`, delta: -22 });
    } else if (maxRow === 3) {
      evScore -= 8;
      penalties.push({ reason: 'OMR 가로 같은 줄 3개 배열', delta: -8 });
    }

    if (maxCol >= 4) {
      evScore -= 22;
      penalties.push({ reason: `OMR 세로 같은 열 ${maxCol}개 집중`, delta: -22 });
    } else if (maxCol === 3) {
      evScore -= 9;
      penalties.push({ reason: 'OMR 세로 같은 열 3개 배열', delta: -9 });
    }

    if (maxDiag >= 4) {
      evScore -= 20;
      penalties.push({ reason: `OMR 대각선 패턴 ${maxDiag}개 정렬`, delta: -20 });
    } else if (maxDiag === 3) {
      evScore -= 7;
      penalties.push({ reason: 'OMR 대각선 3개 정렬', delta: -7 });
    }

    if (borderCnt >= 5) {
      evScore -= 10;
      penalties.push({ reason: `OMR 테두리 집중 (${borderCnt}개)`, delta: -10 });
    }

    // 3. 등차수열 / 규칙성 (AC값)
    const ac = calcAC(sorted);
    if (ac <= 4) {
      evScore -= 25;
      penalties.push({ reason: `극단적 규칙 배열 (AC=${ac})`, delta: -25 });
    } else if (ac <= 6) {
      evScore -= 10;
      penalties.push({ reason: `규칙성 높음 (AC=${ac})`, delta: -10 });
    }

    // 4. 3연속 이상 및 7의 배수·끝수 동일 편향
    let maxRun = 1, curRun = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) {
        curRun++;
        if (curRun > maxRun) maxRun = curRun;
      } else {
        curRun = 1;
      }
    }
    if (maxRun >= 3) {
      evScore -= 14;
      penalties.push({ reason: `${maxRun}연속 번호 포함`, delta: -14 });
    }

    const lastDigits = {};
    sorted.forEach(n => { const d = n % 10; lastDigits[d] = (lastDigits[d] || 0) + 1; });
    const maxSameLast = Math.max(...Object.values(lastDigits));
    if (maxSameLast >= 3) {
      evScore -= 10;
      penalties.push({ reason: `동일 끝자리 ${maxSameLast}개 중복`, delta: -10 });
    }

    // 5. 직전 회차 중복 (많은 구매자가 직전 번호를 그대로 따라 적음)
    let carryover = 0;
    if (context && context.latestNums && context.latestNums.length === 6) {
      const latestSet = new Set(context.latestNums);
      carryover = sorted.filter(n => latestSet.has(n)).length;
      if (carryover >= 3) {
        evScore -= 14;
        penalties.push({ reason: `직전 회차 번호 ${carryover}개 중복`, delta: -14 });
      }
    }

    // 6. 역대 1등 기출 조합 6개 완전 일치
    const key = sorted.join(',');
    const exactHistMatch = !!(context && context.pastWinSet && context.pastWinSet.has(key));
    if (exactHistMatch) {
      evScore -= 30;
      penalties.push({ reason: '역대 1등 기출 조합과 6개 완전 일치', delta: -30 });
    }

    evScore = Math.max(0, Math.min(100, evScore));
    const riskLevel = evScore >= 80 ? '낮음 (분할 회피 유리)' : evScore >= 60 ? '보통' : '높음 (상금 분할 주의)';
    return {
      evScore,
      riskLevel,
      under31,
      over31,
      maxRow,
      maxCol,
      maxDiag,
      carryover,
      exactHistMatch,
      penalties
    };
  }

  // 통합 조합 평가 (패턴 스코어 + 군집 회피 EV)
  function evaluateCombo(nums, context) {
    const sorted = [...nums].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const odds = sorted.filter(n => n % 2 !== 0).length;
    const lows = sorted.filter(n => n <= 22).length;
    const zones = new Set(sorted.map(n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5)).size;
    const ac = calcAC(sorted);
    const entropy = calcZoneEntropy(sorted);
    const lastDigitSum = sorted.reduce((a, b) => a + (b % 10), 0);

    let consecPairs = 0;
    let inRun = false;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1] - sorted[i] === 1) {
        if (!inRun) { consecPairs++; inRun = true; }
      } else {
        inRun = false;
      }
    }

    let carryover = 0;
    if (context && context.latestNums && context.latestNums.length === 6) {
      const s = new Set(context.latestNums);
      carryover = sorted.filter(n => s.has(n)).length;
    }

    // 100점 만점 통합 패턴 스코어
    const details = [];
    const sumPts = (sum >= 100 && sum <= 175) ? 20 : (sum >= 85 && sum <= 195) ? 10 : 0;
    details.push({ label: '번호 합계', val: `${sum}`, pts: sumPts, max: 20 });

    const oePts = (odds >= 2 && odds <= 4) ? 15 : (odds === 1 || odds === 5) ? 7 : 0;
    details.push({ label: '홀짝 비율', val: `${odds}:${6 - odds}`, pts: oePts, max: 15 });

    const hlPts = (lows >= 2 && lows <= 4) ? 15 : (lows === 1 || lows === 5) ? 7 : 0;
    details.push({ label: '고저 비율', val: `저${lows}:고${6 - lows}`, pts: hlPts, max: 15 });

    const acPts = (ac >= 7 && ac <= 10) ? 15 : (ac >= 5) ? 7 : 0;
    details.push({ label: 'AC 복잡도', val: `AC ${ac}`, pts: acPts, max: 15 });

    const entPts = entropy >= 1.79 ? 15 : entropy >= 1.45 ? 8 : 0;
    details.push({ label: '샤논 엔트로피', val: `${entropy} (${zones}구간)`, pts: entPts, max: 15 });

    const ldPts = (lastDigitSum >= 15 && lastDigitSum <= 38) ? 10 : 4;
    details.push({ label: '끝수 합계', val: `${lastDigitSum}`, pts: ldPts, max: 10 });

    const conPts = consecPairs <= 1 ? 10 : consecPairs === 2 ? 5 : 0;
    details.push({ label: '연속·이월', val: `연속${consecPairs}쌍 / 이월${carryover}개`, pts: conPts, max: 10 });

    const patternScore = sumPts + oePts + hlPts + acPts + entPts + ldPts + conPts;
    const ev = evaluateAntiCrowding(sorted, context);

    return {
      nums: sorted,
      patternScore,
      evScore: ev.evScore,
      totalScore: Math.round(patternScore * 0.5 + ev.evScore * 0.5),
      sum,
      odds,
      lows,
      zones,
      ac,
      entropy,
      lastDigitSum,
      consecPairs,
      carryover,
      details,
      ev
    };
  }

  // 컨텍스트 빌더 (전체 회차 1등 셋 + 최신 회차 + 빈도 + 마르코프 가중치)
  function buildContext(draws) {
    const pastWinSet = new Set();
    const pastWinList = [];
    for (let i = 0; i < draws.length; i++) {
      const s = [...draws[i].nums].sort((a, b) => a - b);
      pastWinSet.add(s.join(','));
      pastWinList.push(s);
    }
    const latest = draws.length ? draws[draws.length - 1] : null;
    const freq = calcFrequencies(draws);
    return {
      drawsCount: draws.length,
      latestDrawNo: latest ? latest.drwNo : 0,
      latestNums: latest ? latest.nums : [],
      pastWinSet,
      pastWinList,
      freq
    };
  }

  // 역대 1등 당첨번호와 5개 이상 겹치는지 확인
  function hasPast5PlusMatch(nums, pastWinList) {
    if (!pastWinList || !pastWinList.length) return false;
    for (let i = 0; i < pastWinList.length; i++) {
      const w = pastWinList[i];
      let m = 0;
      for (let j = 0; j < 6; j++) {
        if (w.includes(nums[j])) m++;
      }
      if (m >= 5) return true;
    }
    return false;
  }

  // 필터 통과 여부 판정 (생성기 & 백테스트 공용)
  function passesFilter(evResult, opts, context) {
    if (!opts) return true;
    if (opts.sumMin != null && evResult.sum < opts.sumMin) return false;
    if (opts.sumMax != null && evResult.sum > opts.sumMax) return false;
    if (opts.acMin != null && evResult.ac < opts.acMin) return false;
    if (opts.entropyMin != null && evResult.entropy < opts.entropyMin) return false;
    if (opts.minPatternScore != null && evResult.patternScore < opts.minPatternScore) return false;
    if (opts.minEvScore != null && evResult.evScore < opts.minEvScore) return false;
    if (opts.maxCarryover != null && evResult.carryover > opts.maxCarryover) return false;
    if (opts.excludePastWin && evResult.ev.exactHistMatch) return false;
    if (opts.excludePast5Match && context && hasPast5PlusMatch(evResult.nums, context.pastWinList)) return false;
    if (opts.balancedOE && (evResult.odds < 2 || evResult.odds > 4)) return false;
    return true;
  }

  // 가중치 비복원 추출
  function sampleWeighted(pool, weights, count, rng) {
    const avail = pool.slice();
    const w = weights.slice();
    const chosen = [];
    for (let k = 0; k < count && avail.length > 0; k++) {
      let total = 0;
      for (let i = 0; i < w.length; i++) total += w[i];
      let r = rng() * total;
      let pickIdx = avail.length - 1;
      for (let i = 0; i < w.length; i++) {
        r -= w[i];
        if (r <= 0) { pickIdx = i; break; }
      }
      chosen.push(avail.splice(pickIdx, 1)[0]);
      w.splice(pickIdx, 1);
    }
    return chosen;
  }

  // 스마트 포트폴리오 생성기 (고정수·제외수 + 통합 필터 + 게임 간 중복 제어)
  function generatePortfolio(draws, opts) {
    const context = buildContext(draws);
    const rng = opts.seed != null ? createRng(opts.seed) : Math.random;
    const gameCount = Math.max(1, Math.min(20, opts.gameCount || 5));
    const maxOverlap = opts.maxOverlap != null ? opts.maxOverlap : 2;
    const strategy = opts.strategy || 'ev_balanced';

    const fixed = [...new Set((opts.fixedNums || []).filter(n => n >= 1 && n <= 45))].slice(0, 5);
    const excludedSet = new Set((opts.excludedNums || []).filter(n => n >= 1 && n <= 45 && !fixed.includes(n)));
    const pool = [];
    for (let n = 1; n <= 45; n++) {
      if (!fixed.includes(n) && !excludedSet.has(n)) pool.push(n);
    }
    const need = 6 - fixed.length;
    if (pool.length < need) {
      return { error: '제외수가 너무 많아 6개 번호를 구성할 수 없습니다.', games: [] };
    }

    // 전략별 샘플링 가중치 구성
    const markov = (strategy === 'markov' || strategy === 'ev_markov') && draws.length >= 30 ? analyzeMarkov(draws) : null;
    const avgFreq = draws.length ? (draws.length * 6) / 45 : 1;
    const weights = pool.map(n => {
      if (strategy === 'random') return 1;
      if (strategy === 'ev_only') return n > 31 ? 1.85 : 1.0;
      if (strategy === 'ev_balanced') return n > 31 ? 1.45 : 1.0;
      if (strategy === 'ev_markov') {
        const evW = n > 31 ? 1.45 : 1.0;
        const mkW = markov ? Math.max(0.2, (markov.nextProbMap[n] || 0.133) * 10) : 1.0;
        return evW * mkW;
      }
      if (strategy === 'hot') return Math.max(0.2, (context.freq[n] || avgFreq) / avgFreq);
      if (strategy === 'cold') return Math.max(0.2, avgFreq / Math.max(1, context.freq[n] || 1));
      if (strategy === 'markov' && markov) {
        const score = markov.nextProbMap[n] || 0.133;
        return Math.max(0.2, score * 10);
      }
      return 1;
    });

    const games = [];
    const seenKeys = new Set();
    let relaxed = false;

    for (let g = 0; g < gameCount; g++) {
      let bestCandidate = null;
      let accepted = null;
      const maxAttempts = strategy === 'random' ? 50 : 600;

      for (let a = 0; a < maxAttempts; a++) {
        const picked = sampleWeighted(pool, weights, need, rng);
        const combo = [...fixed, ...picked].sort((a, b) => a - b);
        const key = combo.join(',');
        if (seenKeys.has(key)) continue;

        // 포트폴리오 중복 제어 검사
        let maxOvWithExisting = 0;
        for (let e = 0; e < games.length; e++) {
          let ov = 0;
          const prev = games[e].nums;
          for (let j = 0; j < 6; j++) if (prev.includes(combo[j])) ov++;
          if (ov > maxOvWithExisting) maxOvWithExisting = ov;
        }

        const evRes = evaluateCombo(combo, context);
        if (!bestCandidate || evRes.totalScore > bestCandidate.totalScore) {
          bestCandidate = evRes;
        }

        const ovOk = (strategy === 'random') || (maxOvWithExisting <= maxOverlap);
        const fltOk = (strategy === 'random') || passesFilter(evRes, opts, context);

        if (ovOk && fltOk) {
          accepted = evRes;
          break;
        }
      }

      if (!accepted && bestCandidate) {
        accepted = bestCandidate;
        relaxed = true;
      }
      if (accepted) {
        seenKeys.add(accepted.nums.join(','));
        games.push(accepted);
      }
    }

    // 포트폴리오 커버리지 요약 통계
    const uniqueNums = new Set();
    games.forEach(g => g.nums.forEach(n => uniqueNums.add(n)));
    let pairOverlapSum = 0, pairCount = 0, maxObservedOverlap = 0;
    for (let i = 0; i < games.length; i++) {
      for (let j = i + 1; j < games.length; j++) {
        let ov = 0;
        for (let k = 0; k < 6; k++) if (games[j].nums.includes(games[i].nums[k])) ov++;
        pairOverlapSum += ov;
        pairCount++;
        if (ov > maxObservedOverlap) maxObservedOverlap = ov;
      }
    }

    return {
      games,
      relaxed,
      uniqueCoverage: uniqueNums.size,
      avgOverlap: pairCount ? Number((pairOverlapSum / pairCount).toFixed(2)) : 0,
      maxObservedOverlap,
      avgPattern: games.length ? Math.round(games.reduce((s, g) => s + g.patternScore, 0) / games.length) : 0,
      avgEv: games.length ? Math.round(games.reduce((s, g) => s + g.evScore, 0) / games.length) : 0
    };
  }

  // 당첨 등급 판정
  function gradeTicket(ticketNums, winNums, bonus) {
    let matches = 0;
    for (let i = 0; i < 6; i++) {
      if (winNums.includes(ticketNums[i])) matches++;
    }
    if (matches === 6) return 1;
    if (matches === 5 && ticketNums.includes(bonus)) return 2;
    if (matches === 5) return 3;
    if (matches === 4) return 4;
    if (matches === 3) return 5;
    return 0;
  }

  const AVG_PRIZES = { 1: 2000000000, 2: 50000000, 3: 1500000, 4: 50000, 5: 5000, 0: 0 };

  // 역대 전체 회차 백테스트 (통과율 + Walk-Forward 모의 투자 vs 무작위 대조군)
  function runBacktest(draws, filterOpts, simOpts) {
    const N = draws.length;
    if (N < 20) return { error: '최소 20회차 이상의 데이터가 필요합니다.' };

    // 1. 역대 전체 당첨번호 필터 통과율 측정
    let histPass = 0;
    for (let i = 0; i < N; i++) {
      const prevNums = i > 0 ? draws[i - 1].nums : [];
      const evRes = evaluateCombo(draws[i].nums, { latestNums: prevNums, pastWinSet: null });
      if (passesFilter(evRes, { ...filterOpts, excludePastWin: false })) histPass++;
    }
    const histPassRate = Number(((histPass / N) * 100).toFixed(2));

    // 2. 무작위 3,000개 표본으로 전체 814만 조합 통과 비율(표본 축소율) 추정
    const rngEst = createRng(20261124);
    const all45 = Array.from({ length: 45 }, (_, i) => i + 1);
    const w1 = new Array(45).fill(1);
    let randPass = 0;
    const latestCtx = { latestNums: draws[N - 1].nums, pastWinSet: null };
    const sampleSize = 3000;
    for (let s = 0; s < sampleSize; s++) {
      const c = sampleWeighted(all45, w1, 6, rngEst).sort((a, b) => a - b);
      const evRes = evaluateCombo(c, latestCtx);
      if (passesFilter(evRes, { ...filterOpts, excludePastWin: false })) randPass++;
    }
    const spacePassRate = Number(((randPass / sampleSize) * 100).toFixed(2));

    // 3. Walk-Forward 모의 투자 시뮬레이션 (최근 K회차 x 주당 M게임)
    const weeks = Math.min(N - 1, Math.max(10, (simOpts && simOpts.weeks) || 100));
    const gamesPerWeek = Math.min(10, Math.max(1, (simOpts && simOpts.gamesPerWeek) || 5));
    const rngSim = createRng((simOpts && simOpts.seed) || 424242);

    const stratCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 0: 0 };
    const randCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 0: 0 };
    let stratPayout = 0, randPayout = 0;
    const startIdx = N - weeks;

    for (let idx = startIdx; idx < N; idx++) {
      const target = draws[idx];
      const prevNums = idx > 0 ? draws[idx - 1].nums : [];
      const ctx = { latestNums: prevNums, pastWinSet: null };

      // 필터 전략 M게임 생성
      for (let g = 0; g < gamesPerWeek; g++) {
        let picked = null;
        for (let a = 0; a < 120; a++) {
          const c = sampleWeighted(all45, w1, 6, rngSim).sort((a, b) => a - b);
          const evRes = evaluateCombo(c, ctx);
          if (passesFilter(evRes, { ...filterOpts, excludePastWin: false })) {
            picked = c;
            break;
          }
        }
        if (!picked) picked = sampleWeighted(all45, w1, 6, rngSim).sort((a, b) => a - b);
        const gr = gradeTicket(picked, target.nums, target.bonus);
        stratCounts[gr]++;
        stratPayout += AVG_PRIZES[gr];
      }

      // 완전 무작위 대조군 M게임
      for (let g = 0; g < gamesPerWeek; g++) {
        const c = sampleWeighted(all45, w1, 6, rngSim).sort((a, b) => a - b);
        const gr = gradeTicket(c, target.nums, target.bonus);
        randCounts[gr]++;
        randPayout += AVG_PRIZES[gr];
      }
    }

    const totalCost = weeks * gamesPerWeek * 1000;
    return {
      totalDraws: N,
      histPass,
      histPassRate,
      spacePassRate,
      filteredOutRate: Number((100 - spacePassRate).toFixed(2)),
      weeks,
      gamesPerWeek,
      totalCost,
      strategy: {
        counts: stratCounts,
        payout: stratPayout,
        roi: Number(((stratPayout / totalCost) * 100).toFixed(1))
      },
      baseline: {
        counts: randCounts,
        payout: randPayout,
        roi: Number(((randPayout / totalCost) * 100).toFixed(1))
      }
    };
  }

  // 마르코프 체인 상태 전이 분석
  function analyzeMarkov(draws) {
    const N = draws.length;
    if (N < 30) return { error: '최소 30회차 이상 필요합니다.' };

    // 1. 미출현 공백 상태별 다음 회차 출현 전이 확률
    // S0: 직전 출현(gap=0), S1: 1~3회 공백, S2: 4~7회, S3: 8~12회, S4: 13회+
    const buckets = [
      { id: 'S0', label: '직전 회차 출현 (이월)', hits: 0, total: 0 },
      { id: 'S1', label: '1~3회 미출현', hits: 0, total: 0 },
      { id: 'S2', label: '4~7회 미출현', hits: 0, total: 0 },
      { id: 'S3', label: '8~12회 미출현', hits: 0, total: 0 },
      { id: 'S4', label: '13회 이상 장기 미출현', hits: 0, total: 0 }
    ];
    function gapToBucket(g) {
      if (g === 0) return 0;
      if (g <= 3) return 1;
      if (g <= 7) return 2;
      if (g <= 12) return 3;
      return 4;
    }

    const lastSeen = new Array(46).fill(-1);
    // 1단계 번호 간 전이 행렬 trans[a][b]: a가 나온 다음 회차에 b가 나온 횟수
    const trans = Array.from({ length: 46 }, () => new Uint16Array(46));
    const appearanceCount = new Uint16Array(46);

    for (let t = 0; t < N; t++) {
      const curSet = new Set(draws[t].nums);
      if (t >= 15) {
        for (let n = 1; n <= 45; n++) {
          if (lastSeen[n] < 0) continue;
          const gapBefore = (t - 1) - lastSeen[n];
          const bIdx = gapToBucket(gapBefore);
          buckets[bIdx].total++;
          if (curSet.has(n)) buckets[bIdx].hits++;
        }
      }
      if (t > 0) {
        const prevNums = draws[t - 1].nums;
        for (let i = 0; i < 6; i++) {
          const a = prevNums[i];
          appearanceCount[a]++;
          for (let j = 0; j < 6; j++) {
            trans[a][draws[t].nums[j]]++;
          }
        }
      }
      draws[t].nums.forEach(n => { lastSeen[n] = t; });
    }

    const stateTransitions = buckets.map(b => ({
      ...b,
      prob: b.total > 0 ? Number(((b.hits / b.total) * 100).toFixed(2)) : 0,
      diffFromTheory: b.total > 0 ? Number((((b.hits / b.total) - 6 / 45) * 100).toFixed(2)) : 0
    }));

    // 직전 최신 회차 6개 번호 기준 다음 회차 조건부 전이 확률 평균
    const latestNums = draws[N - 1].nums;
    const nextProbs = [];
    const nextProbMap = {};
    for (let b = 1; b <= 45; b++) {
      let sumP = 0;
      for (let i = 0; i < 6; i++) {
        const a = latestNums[i];
        sumP += appearanceCount[a] > 0 ? trans[a][b] / appearanceCount[a] : 6 / 45;
      }
      const avgP = sumP / 6;
      const curGap = lastSeen[b] >= 0 ? (N - 1 - lastSeen[b]) : N;
      const bProb = buckets[gapToBucket(curGap)].total > 0
        ? buckets[gapToBucket(curGap)].hits / buckets[gapToBucket(curGap)].total
        : 6 / 45;
      // 1단계 번호 전이 60% + 공백 상태 전이 40% 혼합
      const combined = avgP * 0.6 + bProb * 0.4;
      nextProbMap[b] = combined;
      nextProbs.push({
        n: b,
        transProb: Number((avgP * 100).toFixed(2)),
        stateProb: Number((bProb * 100).toFixed(2)),
        combinedProb: Number((combined * 100).toFixed(2)),
        curGap
      });
    }
    nextProbs.sort((a, b) => b.combinedProb - a.combinedProb);

    return {
      drawsCount: N,
      latestDrawNo: draws[N - 1].drwNo,
      latestNums,
      theoryPct: 13.33,
      stateTransitions,
      topNext: nextProbs.slice(0, 12),
      nextProbMap
    };
  }

  // 몬테카를로 장기 손익 시뮬레이션 (정확한 6/45 이론 당첨 확률 기반 고속 시행)
  function runMonteCarlo(gamesPerWeek, weeks, trials, seed) {
    const rng = createRng(seed || 20261124);
    const totalGames = gamesPerWeek * weeks;
    const totalCost = totalGames * 1000;

    // 6/45 정확한 등수별 누적 확률 경계
    const P1 = 1 / 8145060;
    const P2 = 6 / 8145060;
    const P3 = 228 / 8145060;
    const P4 = 11115 / 8145060;
    const P5 = 182780 / 8145060;
    const C1 = P1, C2 = C1 + P2, C3 = C2 + P3, C4 = C3 + P4, C5 = C4 + P5;

    const rois = new Float64Array(trials);
    const nets = new Float64Array(trials);
    let profitTrials = 0;
    let sumRoi = 0;
    let total3 = 0, total4 = 0, total5 = 0, total12 = 0;

    for (let t = 0; t < trials; t++) {
      let payout = 0;
      for (let g = 0; g < totalGames; g++) {
        const u = rng();
        if (u < C5) {
          if (u < C1) { payout += AVG_PRIZES[1]; total12++; }
          else if (u < C2) { payout += AVG_PRIZES[2]; total12++; }
          else if (u < C3) { payout += AVG_PRIZES[3]; total3++; }
          else if (u < C4) { payout += AVG_PRIZES[4]; total4++; }
          else { payout += AVG_PRIZES[5]; total5++; }
        }
      }
      const roi = (payout / totalCost) * 100;
      rois[t] = roi;
      nets[t] = payout - totalCost;
      sumRoi += roi;
      if (payout >= totalCost) profitTrials++;
    }

    const sortedRois = Array.from(rois).sort((a, b) => a - b);
    const sortedNets = Array.from(nets).sort((a, b) => a - b);
    const p10 = sortedNets[Math.floor(trials * 0.1)];
    const p50 = sortedNets[Math.floor(trials * 0.5)];
    const p90 = sortedNets[Math.floor(trials * 0.9)];

    // ROI 히스토그램 6개 구간
    const bins = [
      { label: '0~15%', min: 0, max: 15, count: 0, profit: false },
      { label: '15~30%', min: 15, max: 30, count: 0, profit: false },
      { label: '30~50%', min: 30, max: 50, count: 0, profit: false },
      { label: '50~75%', min: 50, max: 75, count: 0, profit: false },
      { label: '75~100%', min: 75, max: 100, count: 0, profit: false },
      { label: '100%+', min: 100, max: Infinity, count: 0, profit: true }
    ];
    for (let t = 0; t < trials; t++) {
      const r = rois[t];
      for (let b = 0; b < bins.length; b++) {
        if (r >= bins[b].min && r < bins[b].max) { bins[b].count++; break; }
      }
    }

    return {
      gamesPerWeek,
      weeks,
      trials,
      totalGames,
      totalCost,
      profitProb: Number(((profitTrials / trials) * 100).toFixed(2)),
      avgRoi: Number((sumRoi / trials).toFixed(1)),
      medianRoi: Number(sortedRois[Math.floor(trials * 0.5)].toFixed(1)),
      p10Net: Math.round(p10),
      p50Net: Math.round(p50),
      p90Net: Math.round(p90),
      avgHits: {
        top12: Number((total12 / trials).toFixed(4)),
        rank3: Number((total3 / trials).toFixed(2)),
        rank4: Number((total4 / trials).toFixed(2)),
        rank5: Number((total5 / trials).toFixed(1))
      },
      bins: bins.map(b => ({ ...b, pct: Number(((b.count / trials) * 100).toFixed(1)) }))
    };
  }

  // 연관 규칙 리프트(Lift) 분석 (동반 출현 + 배척 쌍)
  function analyzeAssociationLift(draws) {
    const N = draws.length;
    if (N < 30) return { positive: [], negative: [] };
    const single = new Uint16Array(46);
    const pair = {};
    for (let i = 0; i < N; i++) {
      const s = [...draws[i].nums].sort((a, b) => a - b);
      for (let a = 0; a < 6; a++) {
        single[s[a]]++;
        for (let b = a + 1; b < 6; b++) {
          const key = `${s[a]}-${s[b]}`;
          pair[key] = (pair[key] || 0) + 1;
        }
      }
    }
    const list = [];
    for (let a = 1; a <= 45; a++) {
      for (let b = a + 1; b <= 45; b++) {
        const cnt = pair[`${a}-${b}`] || 0;
        const pA = single[a] / N;
        const pB = single[b] / N;
        const pAB = cnt / N;
        // 비복원 6/45 이론적 동반 확률 보정 계수: (5/44)/(6/45) = 0.8523
        const expectedIndependent = pA * pB * ((5 / 44) / (6 / 45));
        const lift = expectedIndependent > 0 ? pAB / expectedIndependent : 0;
        list.push({
          a, b, count: cnt,
          pct: Number((pAB * 100).toFixed(2)),
          lift: Number(lift.toFixed(2))
        });
      }
    }
    const positive = [...list].sort((x, y) => y.lift - x.lift || y.count - x.count).slice(0, 12);
    const negative = [...list].sort((x, y) => x.lift - y.lift || x.count - y.count).slice(0, 10);
    return { positive, negative, drawsCount: N };
  }

  // Gap 분석 (미출현 기간)
  function analyzeGap(draws) {
    const N = draws.length;
    const lastSeen = {};
    const gaps = {};
    for (let n = 1; n <= 45; n++) { lastSeen[n] = -1; gaps[n] = []; }
    draws.forEach((d, idx) => {
      d.nums.forEach(n => {
        if (lastSeen[n] >= 0) gaps[n].push(idx - lastSeen[n]);
        lastSeen[n] = idx;
      });
    });
    const list = [];
    for (let n = 1; n <= 45; n++) {
      const avgGap = gaps[n].length ? gaps[n].reduce((a, b) => a + b, 0) / gaps[n].length : N;
      const curGap = lastSeen[n] >= 0 ? (N - 1 - lastSeen[n]) : N;
      list.push({
        n,
        curGap,
        avgGap: Number(avgGap.toFixed(1)),
        ratio: Number((curGap / Math.max(avgGap, 1)).toFixed(2))
      });
    }
    return list;
  }

  // 최근 트렌드 분석
  function analyzeTrend(draws, windowSize) {
    const N = draws.length;
    const w = Math.min(N, windowSize || 30);
    const recent = draws.slice(-w);
    const recentFreq = calcFrequencies(recent);
    const allFreq = calcFrequencies(draws);
    const list = [];
    for (let n = 1; n <= 45; n++) {
      const rRate = recentFreq[n] / w;
      const aRate = allFreq[n] / N;
      list.push({
        n,
        recentCount: recentFreq[n],
        recentPct: Number((rRate * 100).toFixed(1)),
        allPct: Number((aRate * 100).toFixed(1)),
        ratio: Number((aRate > 0 ? rRate / aRate : 0).toFixed(2))
      });
    }
    return {
      window: w,
      hot: [...list].sort((a, b) => b.ratio - a.ratio).slice(0, 10),
      cold: [...list].sort((a, b) => a.ratio - b.ratio).slice(0, 10)
    };
  }

  // 델타(인접 간격) & AC/끝자리 & 위치별 분석
  function analyzeStructural(draws) {
    const N = draws.length;
    const deltaFreq = {};
    const acFreq = {};
    const ldFreq = new Array(10).fill(0);
    const pos = Array.from({ length: 6 }, () => ({}));
    let deltaSum = 0, deltaCnt = 0, acSum = 0;

    draws.forEach(d => {
      const s = [...d.nums].sort((a, b) => a - b);
      for (let i = 0; i < 6; i++) {
        pos[i][s[i]] = (pos[i][s[i]] || 0) + 1;
        ldFreq[s[i] % 10]++;
        if (i < 5) {
          const dl = s[i + 1] - s[i];
          deltaFreq[dl] = (deltaFreq[dl] || 0) + 1;
          deltaSum += dl;
          deltaCnt++;
        }
      }
      const ac = calcAC(s);
      acFreq[ac] = (acFreq[ac] || 0) + 1;
      acSum += ac;
    });

    return {
      drawsCount: N,
      avgDelta: deltaCnt ? Number((deltaSum / deltaCnt).toFixed(2)) : 0,
      topDeltas: Object.entries(deltaFreq).map(([d, c]) => ({ delta: Number(d), count: c })).sort((a, b) => b.count - a.count).slice(0, 10),
      avgAC: N ? Number((acSum / N).toFixed(2)) : 0,
      acDist: Object.entries(acFreq).map(([ac, c]) => ({ ac: Number(ac), count: c, pct: Number(((c / N) * 100).toFixed(1)) })).sort((a, b) => a.ac - b.ac),
      lastDigits: ldFreq.map((c, d) => ({ digit: d, count: c, pct: Number(((c / (N * 6)) * 100).toFixed(1)) })),
      positional: pos.map(p => Object.entries(p).map(([n, c]) => ({ n: Number(n), count: c })).sort((a, b) => b.count - a.count).slice(0, 5))
    };
  }

  // 역대 일치 이력 조회 (내 번호 6개와 과거 1~3등 일치 기록)
  function searchHistoricalMatches(nums, draws) {
    const matches = { rank1: [], rank2: [], rank3: [], rank4Count: 0, rank5Count: 0 };
    for (let i = 0; i < draws.length; i++) {
      const d = draws[i];
      const g = gradeTicket(nums, d.nums, d.bonus);
      if (g === 1) matches.rank1.push(d);
      else if (g === 2) matches.rank2.push(d);
      else if (g === 3) matches.rank3.push(d);
      else if (g === 4) matches.rank4Count++;
      else if (g === 5) matches.rank5Count++;
    }
    return matches;
  }

  return {
    toOmrCoord,
    createRng,
    calcFrequencies,
    calcChiSquare,
    calcAC,
    calcZoneEntropy,
    evaluateAntiCrowding,
    evaluateCombo,
    buildContext,
    passesFilter,
    generatePortfolio,
    gradeTicket,
    runBacktest,
    analyzeMarkov,
    runMonteCarlo,
    analyzeAssociationLift,
    analyzeGap,
    analyzeTrend,
    analyzeStructural,
    searchHistoricalMatches
  };
});

