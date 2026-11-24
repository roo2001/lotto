/**
 * LottoPro v4.0 Application Controller
 */
'use strict';

const STORE_KEY = 'lottopro_draws';
const META_KEY = 'lottopro_meta';
const TICKET_KEY = 'lottopro_tickets';

const state = {
  drawsMap: {},
  drawsList: [],
  context: null,
  genFixed: new Set(),
  genExcluded: new Set(),
  lastGenGames: [],
  showGenOmr: false,
  wheelSel: new Set(),
  lastWheelTickets: [],
  showWheelOmr: false,
  valSel: new Set()
};

// ─────────────────────────────────────────────
// 유틸 & 저장소
// ─────────────────────────────────────────────
function getBallClass(n) {
  if (n <= 10) return 'b1-10';
  if (n <= 20) return 'b11-20';
  if (n <= 30) return 'b21-30';
  if (n <= 40) return 'b31-40';
  return 'b41-45';
}

function renderBall(n, sm = false) {
  return `<span class="ball ${sm ? 'ball-sm' : ''} ${getBallClass(n)}">${n}</span>`;
}

function renderBalls(nums, sm = false) {
  return nums.map(n => renderBall(n, sm)).join('');
}

function loadLocalDraws() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}

function saveLocalDraws(map) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch (e) { console.warn('storage full', e); }
}

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}

function saveMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
}

function loadTickets() {
  try { return JSON.parse(localStorage.getItem(TICKET_KEY) || '[]'); } catch { return []; }
}

function saveTickets(t) {
  localStorage.setItem(TICKET_KEY, JSON.stringify(t));
}

function estimateLatestDraw() {
  const start = new Date('2002-12-07T00:00:00+09:00');
  return Math.floor((Date.now() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function setSyncStatus(mode, text) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if (dot) dot.className = 'sync-dot ' + mode;
  if (txt) txt.textContent = text;
}

function rebuildStateFromMap(map) {
  state.drawsMap = map;
  state.drawsList = Object.values(map)
    .filter(d => d && d.nums && d.nums.length === 6)
    .map(d => ({ ...d, drwNo: Number(d.drwNo), nums: [...d.nums].map(Number).sort((a, b) => a - b), bonus: Number(d.bonus || 0) }))
    .sort((a, b) => a.drwNo - b.drwNo);
  state.context = LottoEngine.buildContext(state.drawsList);
}

// ─────────────────────────────────────────────
// 7x7 OMR 마킹 용지 렌더러
// ─────────────────────────────────────────────
function renderOmrSlipHtml(nums, title, warnSet) {
  const set = new Set(nums);
  const wSet = warnSet || new Set();
  let cells = '';
  for (let i = 1; i <= 49; i++) {
    if (i > 45) {
      cells += '<div class="omr-cell empty"></div>';
    } else {
      const cls = set.has(i) ? (wSet.has(i) ? 'marked-warn' : 'marked') : '';
      cells += `<div class="omr-cell ${cls}">${i}</div>`;
    }
  }
  return `<div class="omr-slip">
    <div class="omr-slip-head"><span>${title}</span><span>${nums.join(', ')}</span></div>
    <div class="omr-grid">${cells}</div>
  </div>`;
}

// ─────────────────────────────────────────────
// 탭 전환
// ─────────────────────────────────────────────
function switchTab(idx) {
  document.querySelectorAll('#mainTabs .tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  document.querySelectorAll('.panel').forEach((p, i) => p.classList.toggle('active', i === idx));
}

// ─────────────────────────────────────────────
// 탭 0: 통계 · 공정성 (카이제곱 검정 + SVG 차트)
// ─────────────────────────────────────────────
function renderFairnessView(windowSize = 0) {
  document.querySelectorAll('#chiWindowBtns button').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.win) === windowSize);
  });
  const res = LottoEngine.calcChiSquare(state.drawsList, windowSize);
  const winLabel = windowSize === 0 ? `전체 ${res.drawsCount}회차` : `최근 ${res.drawsCount}회차`;

  const summary = document.getElementById('fairnessSummary');
  if (summary) {
    summary.className = 'notice ' + (res.fair ? 'notice-ok' : 'notice-warn');
    summary.innerHTML = res.drawsCount === 0
      ? '회차 데이터를 불러오지 못했습니다.'
      : `<strong>카이제곱 균등성 검정 (${winLabel}):</strong> χ² = ${res.chi2} (자유도 44), p-value = <strong>${res.pValue}</strong> — ` +
        (res.fair
          ? '통계적 편향 없음 (p ≥ 0.05, 정상 무작위 추첨 판정).'
          : '단기 변동 편차 관측 (p < 0.05). 장기 회귀 여부를 참고하세요.');
  }

  const meta = document.getElementById('chartMeta');
  if (meta) {
    meta.textContent = `${winLabel} · 번호당 이론 기대치 ${res.expected}회 · 최다 ${res.maxNum.n}번(${res.maxNum.count}회) / 최소 ${res.minNum.n}번(${res.minNum.count}회)`;
  }

  renderFrequencySvg(res);

  const kpi = document.getElementById('kpiOverview');
  if (kpi && state.drawsList.length) {
    const latest = state.drawsList[state.drawsList.length - 1];
    const struct = LottoEngine.analyzeStructural(state.drawsList);
    kpi.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">실측 분석 회차</div>
        <div class="kpi-val">${state.drawsList.length.toLocaleString()}회</div>
        <div class="kpi-sub">1회 ~ 제${latest.drwNo}회 (${latest.date})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">공정성 p-value (${winLabel})</div>
        <div class="kpi-val ${res.fair ? 'text-ok' : 'text-warn'}">${res.pValue}</div>
        <div class="kpi-sub">χ² = ${res.chi2} / 기준 p ≥ 0.05</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">역대 평균 AC 복잡도</div>
        <div class="kpi-val">${struct.avgAC}</div>
        <div class="kpi-sub">권장 범위 7 ~ 10 (평균 Δ ${struct.avgDelta})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">최신 제${latest.drwNo}회 당첨번호</div>
        <div style="margin-top:4px">${renderBalls(latest.nums, true)}</div>
        <div class="kpi-sub">보너스 ${latest.bonus}번</div>
      </div>
    `;
  }
}

function renderFrequencySvg(chiRes) {
  const box = document.getElementById('freqSvgChart');
  if (!box || !chiRes.drawsCount) return;

  const W = 620, H = 220, padL = 34, padR = 12, padT = 18, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const vals = [];
  for (let n = 1; n <= 45; n++) vals.push(chiRes.freq[n]);
  const maxVal = Math.max(...vals, chiRes.expected * 1.25);
  const minVal = Math.max(0, Math.min(...vals, chiRes.expected * 0.75) * 0.85);
  const range = Math.max(1, maxVal - minVal);
  const sigma = Math.sqrt(chiRes.expected * (1 - 6 / 45));

  const yOf = v => padT + plotH - ((v - minVal) / range) * plotH;
  const yExp = yOf(chiRes.expected);
  const yUpper = yOf(Math.min(maxVal, chiRes.expected + 2 * sigma));
  const yLower = yOf(Math.max(minVal, chiRes.expected - 2 * sigma));

  const barStep = plotW / 45;
  const barW = Math.max(5, barStep - 3);

  let bars = '';
  for (let n = 1; n <= 45; n++) {
    const v = chiRes.freq[n];
    const x = padL + (n - 1) * barStep + 1.5;
    const y = yOf(v);
    const h = Math.max(2, padT + plotH - y);
    const dev = (v - chiRes.expected) / Math.max(sigma, 1);
    const fill = dev >= 2 ? '#b68c4c' : dev <= -2 ? '#b45c67' : '#5279a3';
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}">
      <title>${n}번: ${v}회 (이론 기대치 ${chiRes.expected}회)</title>
    </rect>`;
    if (n === 1 || n % 5 === 0) {
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#768299" font-size="9" font-family="JetBrains Mono,monospace">${n}</text>`;
    }
  }

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    <rect x="${padL}" y="${yUpper.toFixed(1)}" width="${plotW}" height="${Math.max(2, yLower - yUpper).toFixed(1)}" fill="rgba(77,148,120,0.10)" />
    <line x1="${padL}" y1="${yExp.toFixed(1)}" x2="${W - padR}" y2="${yExp.toFixed(1)}" stroke="#4d9478" stroke-width="1.2" stroke-dasharray="4 3" />
    <text x="${padL - 5}" y="${yExp.toFixed(1)}" text-anchor="end" dominant-baseline="middle" fill="#4d9478" font-size="9" font-family="JetBrains Mono,monospace">${Math.round(chiRes.expected)}</text>
    <text x="${padL - 5}" y="${padT + 4}" text-anchor="end" fill="#768299" font-size="9" font-family="JetBrains Mono,monospace">${Math.round(maxVal)}</text>
    <text x="${W - padR}" y="${padT - 5}" text-anchor="end" fill="#768299" font-size="9">녹색 점선: 이론 기대치 · 음영: ±2σ 정상 구간</text>
    ${bars}
  </svg>`;
}

function renderHotColdView(type) {
  document.getElementById('btnHotTop')?.classList.toggle('active', type === 'hot');
  document.getElementById('btnColdTop')?.classList.toggle('active', type === 'cold');
  const freq = LottoEngine.calcFrequencies(state.drawsList);
  const total = Math.max(1, state.drawsList.length);
  const entries = Object.entries(freq).map(([n, c]) => ({ n: Number(n), c }));
  entries.sort((a, b) => type === 'hot' ? b.c - a.c : a.c - b.c);
  const top10 = entries.slice(0, 10);
  const maxC = Math.max(...entries.map(e => e.c), 1);

  document.getElementById('hotColdList').innerHTML = top10.map(e => `
    <div class="bar-row">
      ${renderBall(e.n, true)}
      <div class="bar-track"><div class="bar-fill" style="width:${(e.c / maxC * 100).toFixed(1)}%;background:${type === 'hot' ? 'var(--accent)' : 'var(--text-muted)'}"></div></div>
      <span class="bar-val">${e.c}회 (${(e.c / total * 100).toFixed(1)}%)</span>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────
// 탭 1: 스마트 생성 (고정/제외수 + 통합 필터 + 중복 제어 + OMR)
// ─────────────────────────────────────────────
const STRATEGY_HELP = {
  ev_balanced: '<strong>통합 균형 + EV 회피 (추천):</strong> 32~45 고번호에 1.45배 가중치를 두고 추출한 뒤, 합계·홀짝·AC·샤논 엔트로피·OMR 기하 패턴·게임 간 중복 제한을 모두 통과한 조합만 채택합니다. 일상 구매의 기본 전략으로 가장 균형적입니다.',
  ev_markov: '<strong>EV + 마르코프 하이브리드:</strong> 32~45 고번호 EV 가중치(1.45배)와 마르코프 상태·번호 전이 확률을 곱해 추출한 뒤, 통합 패턴·EV·AC·중복 제어·역대 1등 제외 필터를 모두 통과한 조합만 채택합니다.',
  ev_only: '<strong>고번호·분할 회피 극대화:</strong> 32~45 고번호 가중치를 1.85배로 높여 생일(1~31) 쏠림을 강하게 억제합니다. 1~3등 당첨 시 공동 당첨자(상금 분할)를 최소화하는 데 초점을 맞춥니다.',
  markov: '<strong>마르코프 전이 가중 (실험):</strong> 직전 회차 6개 번호 이후 역대 다음 회차 출현 빈도와 공백 상태별 전이 확률을 가중치로 반영합니다. (통계 탐색용 실험 전략)',
  hot: '<strong>실측 상위 빈도 가중:</strong> 1회차~최신 전체 실측 데이터에서 출현 빈도가 높았던 번호에 비례해 가중 추출한 뒤 통합 필터를 적용합니다.',
  cold: '<strong>실측 하위 빈도 가중:</strong> 전체 실측 데이터에서 상대적으로 덜 출현한 번호에 높은 가중치를 부여해 균형 회귀를 탐색합니다.',
  random: '<strong>완전 무작위:</strong> 어떤 가중치나 필터도 적용하지 않고 1~45에서 순수 무작위 추출합니다. 필터 전략과의 비교 대조용으로 활용하세요.'
};

function updateStrategyHelp() {
  const sel = document.getElementById('genStrategy');
  const box = document.getElementById('genStrategyHelp');
  if (sel && box) {
    box.innerHTML = STRATEGY_HELP[sel.value] || STRATEGY_HELP.ev_balanced;
  }
}

function initGenGrid() {
  const el = document.getElementById('genNumGrid');
  if (!el) return;
  let html = '';
  for (let n = 1; n <= 45; n++) {
    html += `<button class="num-btn" id="gn${n}" onclick="cycleGenNum(${n})">${n}</button>`;
  }
  el.innerHTML = html;
}

function cycleGenNum(n) {
  const btn = document.getElementById('gn' + n);
  if (!state.genFixed.has(n) && !state.genExcluded.has(n)) {
    if (state.genFixed.size < 4) {
      state.genFixed.add(n);
      btn.className = 'num-btn fixed';
    } else {
      state.genExcluded.add(n);
      btn.className = 'num-btn excluded';
    }
  } else if (state.genFixed.has(n)) {
    state.genFixed.delete(n);
    state.genExcluded.add(n);
    btn.className = 'num-btn excluded';
  } else {
    state.genExcluded.delete(n);
    btn.className = 'num-btn';
  }
  updateGenSelectionLabels();
}

function updateGenSelectionLabels() {
  const f = [...state.genFixed].sort((a, b) => a - b);
  const e = [...state.genExcluded].sort((a, b) => a - b);
  document.getElementById('genFixedLabel').textContent = f.length ? f.join(', ') : '없음';
  document.getElementById('genExcludedLabel').textContent = e.length ? e.join(', ') : '없음';
}

function resetGenSelection() {
  state.genFixed.clear();
  state.genExcluded.clear();
  for (let n = 1; n <= 45; n++) {
    const b = document.getElementById('gn' + n);
    if (b) b.className = 'num-btn';
  }
  updateGenSelectionLabels();
}

function sendNumbersToGeneratorFixed(nums) {
  resetGenSelection();
  nums.slice(0, 4).forEach(n => {
    state.genFixed.add(n);
    const b = document.getElementById('gn' + n);
    if (b) b.className = 'num-btn fixed';
  });
  updateGenSelectionLabels();
  switchTab(1);
}

function handleGeneratePortfolio() {
  const opts = {
    strategy: document.getElementById('genStrategy').value,
    gameCount: Number(document.getElementById('genCount').value),
    maxOverlap: Number(document.getElementById('genMaxOverlap').value),
    minPatternScore: Number(document.getElementById('genMinPattern').value),
    minEvScore: Number(document.getElementById('genMinEv').value),
    acMin: Number(document.getElementById('genAcMin').value),
    excludePastWin: document.getElementById('genExcludePast').checked,
    excludePast5Match: document.getElementById('genExcludePast5').checked,
    balancedOE: document.getElementById('genBalancedOE').checked,
    fixedNums: [...state.genFixed],
    excludedNums: [...state.genExcluded]
  };
  const res = LottoEngine.generatePortfolio(state.drawsList, opts);
  const area = document.getElementById('genResultArea');
  if (res.error) {
    area.innerHTML = `<div class="notice notice-danger">${res.error}</div>`;
    return;
  }
  state.lastGenGames = res.games;
  renderGenResult(res);
}

function renderGenResult(res) {
  const area = document.getElementById('genResultArea');
  if (!res || !res.games.length) return;

  let body = '';
  if (state.showGenOmr) {
    body = `<div class="omr-wrap">${res.games.map((g, i) => renderOmrSlipHtml(g.nums, `게임 ${i + 1} (EV ${g.evScore})`)).join('')}</div>`;
  } else {
    body = res.games.map((g, i) => `
      <div class="combo-row">
        <span class="combo-idx">#${String(i + 1).padStart(2, '0')}</span>
        <div class="combo-balls">${renderBalls(g.nums, true)}</div>
        <div class="combo-metrics">
          <span class="badge">합 ${g.sum}</span>
          <span class="badge">AC ${g.ac}</span>
          <span class="badge">H ${g.entropy}</span>
          <span class="badge ${g.patternScore >= 75 ? 'badge-ok' : 'badge-warn'}">패턴 ${g.patternScore}</span>
          <span class="badge ${g.evScore >= 80 ? 'badge-ok' : g.evScore >= 60 ? 'badge-warn' : 'badge-danger'}">EV ${g.evScore}</span>
          <button class="btn btn-secondary btn-sm" onclick="quickSaveOne('${g.nums.join(' ')}', this)">저장</button>
        </div>
      </div>
    `).join('');
  }

  area.innerHTML = `<div class="card">
    <div class="card-header">
      <div>
        <div class="card-title">생성 포트폴리오 (${res.games.length}게임)</div>
        <div class="card-meta">고유 번호 커버 ${res.uniqueCoverage}/45개 · 게임 간 평균 중복 ${res.avgOverlap}개 (최대 ${res.maxObservedOverlap}개) · 평균 패턴 ${res.avgPattern}점 · 평균 EV ${res.avgEv}점</div>
      </div>
      ${res.relaxed ? '<span class="badge badge-warn">엄격 조건 일부 완화 적용</span>' : '<span class="badge badge-ok">전체 조건 100% 충족</span>'}
    </div>
    ${body}
  </div>`;
}

function toggleGenOmrView() {
  state.showGenOmr = !state.showGenOmr;
  const btn = document.getElementById('btnToggleGenOmr');
  if (btn) btn.classList.toggle('active', state.showGenOmr);
  if (state.lastGenGames.length) {
    handleReRenderGen();
  }
}

function handleReRenderGen() {
  const games = state.lastGenGames;
  const uniqueNums = new Set();
  games.forEach(g => g.nums.forEach(n => uniqueNums.add(n)));
  let ovSum = 0, cnt = 0, maxOv = 0;
  for (let i = 0; i < games.length; i++) {
    for (let j = i + 1; j < games.length; j++) {
      let ov = 0;
      for (let k = 0; k < 6; k++) if (games[j].nums.includes(games[i].nums[k])) ov++;
      ovSum += ov; cnt++; if (ov > maxOv) maxOv = ov;
    }
  }
  renderGenResult({
    games,
    relaxed: false,
    uniqueCoverage: uniqueNums.size,
    avgOverlap: cnt ? Number((ovSum / cnt).toFixed(2)) : 0,
    maxObservedOverlap: maxOv,
    avgPattern: Math.round(games.reduce((s, g) => s + g.patternScore, 0) / games.length),
    avgEv: Math.round(games.reduce((s, g) => s + g.evScore, 0) / games.length)
  });
}

// ─────────────────────────────────────────────
// 탭 2: 축약 커버링 휠링
// ─────────────────────────────────────────────
function initWheelGrid() {
  const el = document.getElementById('wheelNumGrid');
  if (!el) return;
  let html = '';
  for (let n = 1; n <= 45; n++) {
    html += `<button class="num-btn" id="wn${n}" onclick="toggleWheelNum(${n})">${n}</button>`;
  }
  el.innerHTML = html;
}

function getWheelMaxForMode() {
  const m = document.getElementById('wheelMode')?.value || 'abbr4';
  if (m === 'full') return 10;
  if (m === 'abbr4') return 12;
  return 15;
}

function toggleWheelNum(n) {
  const maxN = getWheelMaxForMode();
  if (state.wheelSel.has(n)) {
    state.wheelSel.delete(n);
    document.getElementById('wn' + n)?.classList.remove('selected');
  } else {
    if (state.wheelSel.size >= maxN) {
      alert(`현재 휠 모드에서는 최대 ${maxN}개까지 선택할 수 있습니다.`);
      return;
    }
    state.wheelSel.add(n);
    document.getElementById('wn' + n)?.classList.add('selected');
  }
  updateWheelInfo();
}

function updateWheelInfo() {
  const arr = [...state.wheelSel].sort((a, b) => a - b);
  document.getElementById('wheelSelCount').textContent = `${arr.length}개 선택`;
  document.getElementById('wheelFullCount').textContent = LottoWheels.comb(arr.length, 6).toLocaleString();
  document.getElementById('wheelSelList').textContent = arr.length ? arr.join(', ') : '없음';
}

function clearWheelSelection() {
  state.wheelSel.clear();
  for (let n = 1; n <= 45; n++) document.getElementById('wn' + n)?.classList.remove('selected');
  updateWheelInfo();
}

function sendNumbersToWheel(nums) {
  clearWheelSelection();
  const maxN = getWheelMaxForMode();
  nums.slice(0, maxN).forEach(n => {
    state.wheelSel.add(n);
    document.getElementById('wn' + n)?.classList.add('selected');
  });
  updateWheelInfo();
  switchTab(2);
}

function autoPickWheelPool() {
  // 32~45 고번호 4개 + 1~31 균등 분산 6개로 10개 자동 구성
  const high = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45];
  const low = Array.from({ length: 31 }, (_, i) => i + 1);
  const pick = (arr, k) => {
    const c = [...arr], out = [];
    while (out.length < k && c.length) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
    return out;
  };
  sendNumbersToWheel([...pick(low, 6), ...pick(high, 4)].sort((a, b) => a - b));
}

function handleBuildWheel() {
  const mode = document.getElementById('wheelMode').value;
  const nums = [...state.wheelSel].sort((a, b) => a - b);
  const area = document.getElementById('wheelResultArea');
  const t0 = performance.now();

  let res;
  if (mode === 'full') {
    res = LottoWheels.generateFullWheel(nums);
  } else {
    const g = mode === 'abbr4' ? 4 : 3;
    const scoreFn = combo => LottoEngine.evaluateCombo(combo, state.context).totalScore;
    res = LottoWheels.generateAbbreviatedWheel(nums, g, scoreFn);
  }
  const elapsed = Math.round(performance.now() - t0);

  if (res.error) {
    area.innerHTML = `<div class="notice notice-danger">${res.error}</div>`;
    return;
  }

  state.lastWheelTickets = res.tickets;
  state.lastWheelMeta = { ...res, elapsed };
  renderWheelResult();
}

function renderWheelResult() {
  const res = state.lastWheelMeta;
  const area = document.getElementById('wheelResultArea');
  if (!res || !area) return;

  const gLabel = res.guarantee === 6 ? '1등(6개) 보장' : res.guarantee === 4 ? '4등(4개) 보장' : '5등(3개) 보장';
  const cost = res.ticketCount * 1000;
  const fullCost = res.fullCount * 1000;

  let listHtml = '';
  if (state.showWheelOmr) {
    listHtml = `<div class="omr-wrap">${res.tickets.slice(0, 40).map((t, i) => renderOmrSlipHtml(t, `휠 #${i + 1}`)).join('')}</div>`;
  } else {
    listHtml = res.tickets.slice(0, 60).map((t, i) => {
      const ev = LottoEngine.evaluateCombo(t, state.context);
      return `<div class="combo-row">
        <span class="combo-idx">#${String(i + 1).padStart(2, '0')}</span>
        <div class="combo-balls">${renderBalls(t, true)}</div>
        <div class="combo-metrics">
          <span class="badge">합 ${ev.sum}</span>
          <span class="badge">AC ${ev.ac}</span>
          <span class="badge">EV ${ev.evScore}</span>
          <button class="btn btn-secondary btn-sm" onclick="quickSaveOne('${t.join(' ')}', this)">저장</button>
        </div>
      </div>`;
    }).join('');
  }
  if (res.tickets.length > (state.showWheelOmr ? 40 : 60)) {
    listHtml += `<div class="notice">총 ${res.tickets.length}게임 중 일부만 표시했습니다. 전체 저장 버튼을 사용하면 모든 조합이 저장됩니다.</div>`;
  }

  area.innerHTML = `<div class="card">
    <div class="card-header">
      <div>
        <div class="card-title">커버링 휠 생성 결과 (${gLabel})</div>
        <div class="card-meta">연산 시간 ${res.elapsed}ms · 전체 ${res.verified.totalCases.toLocaleString()}개 경우의 수 중 ${res.verified.coveredCases.toLocaleString()}개 검증 완료</div>
      </div>
      <span class="badge badge-ok">수학적 보장률 ${res.verified.coveragePct}%</span>
    </div>
    <div class="grid-4" style="margin-bottom:16px">
      <div class="card-sub"><div class="kpi-label">필요 게임 수</div><div class="kpi-val text-accent">${res.ticketCount}게임</div><div class="kpi-sub">풀 휠 ${res.fullCount}게임 대비</div></div>
      <div class="card-sub"><div class="kpi-label">총 투자 비용</div><div class="kpi-val">${cost.toLocaleString()}원</div><div class="kpi-sub">풀 휠 ${fullCost.toLocaleString()}원</div></div>
      <div class="card-sub"><div class="kpi-label">비용 절감률</div><div class="kpi-val text-ok">${res.savingsPct}%</div><div class="kpi-sub">절감액 ${(fullCost - cost).toLocaleString()}원</div></div>
      <div class="card-sub"><div class="kpi-label">최소 보장 조건</div><div class="kpi-val">${gLabel}</div><div class="kpi-sub">${res.selectedCount}개 중 6개 적중 시</div></div>
    </div>
    ${listHtml}
  </div>`;
}

function toggleWheelOmrView() {
  state.showWheelOmr = !state.showWheelOmr;
  if (state.lastWheelMeta) renderWheelResult();
}

// ─────────────────────────────────────────────
// 탭 3: 조합 검증
// ─────────────────────────────────────────────
function initValidatorGrid() {
  const el = document.getElementById('valNumGrid');
  if (!el) return;
  let html = '';
  for (let n = 1; n <= 45; n++) {
    html += `<button class="num-btn" id="vn${n}" onclick="toggleValNum(${n})">${n}</button>`;
  }
  el.innerHTML = html;
}

function toggleValNum(n) {
  if (state.valSel.has(n)) {
    state.valSel.delete(n);
    document.getElementById('vn' + n)?.classList.remove('selected');
  } else {
    if (state.valSel.size >= 6) return;
    state.valSel.add(n);
    document.getElementById('vn' + n)?.classList.add('selected');
  }
  const arr = [...state.valSel].sort((a, b) => a - b);
  document.getElementById('valCount').textContent = `${arr.length}/6`;
  document.getElementById('valSelList').textContent = arr.length ? arr.join(', ') : '없음';
}

function clearValidator() {
  state.valSel.clear();
  for (let n = 1; n <= 45; n++) document.getElementById('vn' + n)?.classList.remove('selected');
  document.getElementById('valCount').textContent = '0/6';
  document.getElementById('valSelList').textContent = '없음';
  document.getElementById('valResultArea').innerHTML = '';
}

function handleValidateCombo() {
  const arr = [...state.valSel].sort((a, b) => a - b);
  const area = document.getElementById('valResultArea');
  if (arr.length !== 6) {
    area.innerHTML = '<div class="notice notice-warn">정확히 6개 번호를 선택하세요.</div>';
    return;
  }
  const ev = LottoEngine.evaluateCombo(arr, state.context);
  const hist = LottoEngine.searchHistoricalMatches(arr, state.drawsList);

  const penHtml = ev.ev.penalties.length
    ? ev.ev.penalties.map(p => `<div class="kv-row"><span>${p.reason}</span><span class="kv-val ${p.delta < 0 ? 'text-danger' : 'text-ok'}">${p.delta < 0 ? p.delta + '점' : '가점/유리'}</span></div>`).join('')
    : '<div class="notice notice-ok" style="margin:0">군집 편향 및 OMR 기하 패턴 감점 항목이 없습니다.</div>';

  area.innerHTML = `<div class="grid-2">
    <div class="card">
      <div class="card-header">
        <div class="card-title">통합 패턴 · EV 진단 결과</div>
        <span class="badge ${ev.evScore >= 80 ? 'badge-ok' : ev.evScore >= 60 ? 'badge-warn' : 'badge-danger'}">분할 리스크: ${ev.ev.riskLevel}</span>
      </div>
      <div style="margin-bottom:14px">${renderBalls(arr)}</div>
      <div class="grid-3" style="margin-bottom:14px">
        <div class="card-sub"><div class="kpi-label">패턴 점수</div><div class="kpi-val">${ev.patternScore}점</div></div>
        <div class="card-sub"><div class="kpi-label">군집회피 EV</div><div class="kpi-val ${ev.evScore >= 80 ? 'text-ok' : 'text-warn'}">${ev.evScore}점</div></div>
        <div class="card-sub"><div class="kpi-label">종합 점수</div><div class="kpi-val text-accent">${ev.totalScore}점</div></div>
      </div>
      ${ev.details.map(d => `<div class="kv-row"><span>${d.label}</span><span class="kv-val">${d.val} (${d.pts}/${d.max})</span></div>`).join('')}
      <div class="divider"></div>
      <div class="card-title" style="margin-bottom:8px;font-size:13px">군집 회피 상세 분석</div>
      ${penHtml}
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">7×7 OMR 용지 배열 및 역대 일치 이력</div>
      </div>
      ${renderOmrSlipHtml(arr, '동행복권 실제 7×7 마킹 배치')}
      <div class="divider"></div>
      <div class="card-title" style="margin-bottom:8px;font-size:13px">역대 ${state.drawsList.length}회차 대조 결과</div>
      <div class="kv-row"><span>1등 (6개 일치)</span><span class="kv-val ${hist.rank1.length ? 'text-danger' : 'text-ok'}">${hist.rank1.length}회 ${hist.rank1.length ? '(제' + hist.rank1.map(d => d.drwNo).join(',') + '회)' : ''}</span></div>
      <div class="kv-row"><span>2등 (5개+보너스)</span><span class="kv-val">${hist.rank2.length}회</span></div>
      <div class="kv-row"><span>3등 (5개 일치)</span><span class="kv-val">${hist.rank3.length}회 ${hist.rank3.length ? '(제' + hist.rank3.slice(-3).map(d => d.drwNo).join(',') + '회)' : ''}</span></div>
      <div class="kv-row"><span>4등 (4개 일치)</span><span class="kv-val">${hist.rank4Count}회</span></div>
      <div class="kv-row"><span>5등 (3개 일치)</span><span class="kv-val">${hist.rank5Count}회</span></div>
    </div>
  </div>`;
}

function saveValidatedCombo() {
  const arr = [...state.valSel].sort((a, b) => a - b);
  if (arr.length !== 6) { alert('먼저 6개 번호를 선택하세요.'); return; }
  quickSaveOne(arr.join(' '));
  alert('내 번호 추적기에 저장되었습니다.');
}

// ─────────────────────────────────────────────
// 탭 4: 백테스트 · 마르코프 · 몬테카를로
// ─────────────────────────────────────────────
function handleRunBacktest() {
  const filterOpts = {
    sumMin: Number(document.getElementById('btSumMin').value),
    sumMax: Number(document.getElementById('btSumMax').value),
    acMin: Number(document.getElementById('btAcMin').value),
    minEvScore: Number(document.getElementById('btEvMin').value)
  };
  const simOpts = {
    weeks: Number(document.getElementById('btWeeks').value),
    gamesPerWeek: Number(document.getElementById('btGames').value),
    seed: 20261124
  };
  const res = LottoEngine.runBacktest(state.drawsList, filterOpts, simOpts);
  const el = document.getElementById('backtestResult');
  if (res.error) {
    el.innerHTML = `<div class="notice notice-warn">${res.error}</div>`;
    return;
  }

  el.innerHTML = `
    <div class="grid-4" style="margin-bottom:14px">
      <div class="card-sub"><div class="kpi-label">역대 1등 필터 통과율</div><div class="kpi-val text-accent">${res.histPassRate}%</div><div class="kpi-sub">${res.histPass} / ${res.totalDraws}회차</div></div>
      <div class="card-sub"><div class="kpi-label">전체 조합 제거율</div><div class="kpi-val">${res.filteredOutRate}%</div><div class="kpi-sub">통과 표본 비중 ${res.spacePassRate}%</div></div>
      <div class="card-sub"><div class="kpi-label">필터 전략 ROI (${res.weeks}주)</div><div class="kpi-val ${res.strategy.roi >= res.baseline.roi ? 'text-ok' : 'text-warn'}">${res.strategy.roi}%</div><div class="kpi-sub">회수 ${res.strategy.payout.toLocaleString()}원</div></div>
      <div class="card-sub"><div class="kpi-label">무작위 대조군 ROI</div><div class="kpi-val">${res.baseline.roi}%</div><div class="kpi-sub">회수 ${res.baseline.payout.toLocaleString()}원</div></div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>구분 (총 투자 ${res.totalCost.toLocaleString()}원)</th><th class="num">1~2등</th><th class="num">3등</th><th class="num">4등</th><th class="num">5등</th><th class="num">총 회수금</th><th class="num">수익률(ROI)</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>설정 필터 전략</strong></td>
            <td class="num">${res.strategy.counts[1] + res.strategy.counts[2]}회</td>
            <td class="num">${res.strategy.counts[3]}회</td>
            <td class="num">${res.strategy.counts[4]}회</td>
            <td class="num">${res.strategy.counts[5]}회</td>
            <td class="num">${res.strategy.payout.toLocaleString()}원</td>
            <td class="num"><strong>${res.strategy.roi}%</strong></td>
          </tr>
          <tr>
            <td>완전 무작위 대조군</td>
            <td class="num">${res.baseline.counts[1] + res.baseline.counts[2]}회</td>
            <td class="num">${res.baseline.counts[3]}회</td>
            <td class="num">${res.baseline.counts[4]}회</td>
            <td class="num">${res.baseline.counts[5]}회</td>
            <td class="num">${res.baseline.payout.toLocaleString()}원</td>
            <td class="num">${res.baseline.roi}%</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="card-lead" style="margin-top:10px;margin-bottom:0">
      역대 통과율(${res.histPassRate}%)과 전체 조합 통과 비중(${res.spacePassRate}%)이 유사할수록 독립 시행 특성에 부합합니다. 필터의 본질은 적중 확률 상승이 아닌 극단 조합·군집 분할 회피입니다.
    </p>
  `;
}

function handleRunMarkov() {
  const res = LottoEngine.analyzeMarkov(state.drawsList);
  const el = document.getElementById('markovResult');
  if (res.error) { el.innerHTML = `<div class="notice notice-warn">${res.error}</div>`; return; }

  const rows = res.stateTransitions.map(s => `
    <tr>
      <td>${s.label}</td>
      <td class="num">${s.total.toLocaleString()}</td>
      <td class="num">${s.prob}%</td>
      <td class="num ${Math.abs(s.diffFromTheory) > 0.8 ? 'text-warn' : 'text-muted'}">${s.diffFromTheory > 0 ? '+' : ''}${s.diffFromTheory}%p</td>
    </tr>
  `).join('');

  const topNums = res.topNext.slice(0, 10).map(x => x.n);
  el.innerHTML = `
    <div class="table-wrap" style="margin-bottom:14px">
      <table class="data-table">
        <thead><tr><th>이전 회차 상태</th><th class="num">표본 수</th><th class="num">다음 회차 출현율</th><th class="num">이론(13.33%) 대비</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card-title" style="font-size:13px;margin-bottom:8px">제${res.latestDrawNo}회 기준 1단계 전이 확률 상위 10개</div>
    <div class="btn-row" style="margin-bottom:10px">
      ${res.topNext.slice(0, 10).map(x => `<div style="text-align:center">${renderBall(x.n, true)}<div style="font-size:10px;font-family:var(--mono);color:var(--text-muted)">${x.combinedProb}%</div></div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary btn-sm" onclick="sendNumbersToGeneratorFixed([${topNums.slice(0, 4).join(',')}])">상위 4개 고정수로 보내기</button>
      <button class="btn btn-ghost btn-sm" onclick="sendNumbersToWheel([${topNums.join(',')}])">상위 10개 휠링으로 보내기</button>
    </div>
  `;
}

function handleRunMonteCarlo() {
  const g = Math.max(1, Math.min(50, Number(document.getElementById('mcGames').value) || 5));
  const w = Math.max(10, Math.min(1040, Number(document.getElementById('mcWeeks').value) || 260));
  const t = Number(document.getElementById('mcTrials').value) || 2000;
  const res = LottoEngine.runMonteCarlo(g, w, t, 20261124);
  const maxPct = Math.max(...res.bins.map(b => b.pct), 1);

  document.getElementById('mcResult').innerHTML = `
    <div class="grid-3" style="margin-bottom:12px">
      <div class="card-sub"><div class="kpi-label">원금 회수 확률</div><div class="kpi-val ${res.profitProb >= 10 ? 'text-ok' : 'text-warn'}">${res.profitProb}%</div><div class="kpi-sub">총 투자 ${res.totalCost.toLocaleString()}원</div></div>
      <div class="card-sub"><div class="kpi-label">중앙값 손익</div><div class="kpi-val text-danger">${res.p50Net.toLocaleString()}원</div><div class="kpi-sub">평균 ROI ${res.avgRoi}%</div></div>
      <div class="card-sub"><div class="kpi-label">기대 당첨 (평균)</div><div class="kpi-val" style="font-size:14px">4등 ${res.avgHits.rank4} / 5등 ${res.avgHits.rank5}</div><div class="kpi-sub">3등 ${res.avgHits.rank3}회 · 1~2등 ${res.avgHits.top12}회</div></div>
    </div>
    <div class="hist-wrap">
      ${res.bins.map(b => `<div class="hist-col">
        <span class="hist-pct">${b.pct}%</span>
        <div class="hist-bar ${b.profit ? 'profit' : ''}" style="height:${Math.max(4, (b.pct / maxPct) * 100)}%"></div>
        <span class="hist-lbl">${b.label}</span>
      </div>`).join('')}
    </div>
  `;
}

// ─────────────────────────────────────────────
// 탭 5: 심층 분석 (Gap · 트렌드 · 리프트 · 구조)
// ─────────────────────────────────────────────
function renderDeepAnalytics() {
  if (state.drawsList.length < 30) return;
  renderGapView('overdue');
  renderTrendView(30);
  renderLiftView();
  renderStructuralView();
}

function renderGapView(mode, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const list = LottoEngine.analyzeGap(state.drawsList);
  let filtered;
  if (mode === 'overdue') filtered = list.filter(x => x.ratio >= 1.3).sort((a, b) => b.ratio - a.ratio).slice(0, 12);
  else if (mode === 'due') filtered = list.filter(x => x.ratio >= 0.8 && x.ratio < 1.3).sort((a, b) => Math.abs(1 - a.ratio) - Math.abs(1 - b.ratio)).slice(0, 12);
  else filtered = list.filter(x => x.curGap <= 2).sort((a, b) => a.curGap - b.curGap).slice(0, 12);

  const nums = filtered.map(x => x.n);
  document.getElementById('gapView').innerHTML = `
    <div class="btn-row" style="margin-bottom:12px">
      ${filtered.map(x => `<div class="card-sub" style="padding:8px 10px;text-align:center;min-width:74px">
        ${renderBall(x.n, true)}
        <div style="font-size:11px;font-family:var(--mono);margin-top:4px">${x.curGap}회 공백</div>
        <div style="font-size:10px;color:var(--text-muted)">${x.ratio}배</div>
      </div>`).join('')}
    </div>
    ${nums.length ? `<div class="btn-row">
      <button class="btn btn-secondary btn-sm" onclick="sendNumbersToGeneratorFixed([${nums.slice(0, 4).join(',')}])">상위 4개 고정수 적용</button>
      <button class="btn btn-ghost btn-sm" onclick="sendNumbersToWheel([${nums.slice(0, 10).join(',')}])">휠링 풀로 보내기</button>
    </div>` : ''}
  `;
}

function renderTrendView(win, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const t = LottoEngine.analyzeTrend(state.drawsList, win);
  const renderRow = (arr, cls) => `<div class="btn-row" style="margin-bottom:12px">${arr.map(x => `<div style="text-align:center">${renderBall(x.n, true)}<div style="font-size:10px;font-family:var(--mono)" class="${cls}">${x.ratio}x</div></div>`).join('')}</div>`;
  document.getElementById('trendView').innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px">최근 ${t.window}회 강세 상위 10</div>
    ${renderRow(t.hot, 'text-ok')}
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px">최근 ${t.window}회 약세 하위 10</div>
    ${renderRow(t.cold, 'text-danger')}
  `;
}

function renderLiftView() {
  const res = LottoEngine.analyzeAssociationLift(state.drawsList);
  const makeTable = (title, items, badgeCls) => `
    <div>
      <div class="card-title" style="font-size:13px;margin-bottom:10px">${title}</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>번호 쌍</th><th class="num">동반 횟수</th><th class="num">출현율</th><th class="num">리프트(Lift)</th></tr></thead>
        <tbody>${items.map(x => `<tr>
          <td>${renderBall(x.a, true)}${renderBall(x.b, true)}</td>
          <td class="num">${x.count}회</td>
          <td class="num">${x.pct}%</td>
          <td class="num"><span class="badge ${badgeCls}">${x.lift}x</span></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  `;
  document.getElementById('liftView').innerHTML =
    makeTable('양의 연관 상위 12쌍 (함께 출현 경향)', res.positive, 'badge-ok') +
    makeTable('음의 연관 하위 10쌍 (동반 출현 희소)', res.negative, 'badge-warn');
}

function renderStructuralView() {
  const s = LottoEngine.analyzeStructural(state.drawsList);
  const maxD = Math.max(...s.topDeltas.map(x => x.count), 1);
  const maxAC = Math.max(...s.acDist.map(x => x.count), 1);

  document.getElementById('deltaAcView').innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:8px">인접 간격(Δ) 상위 분포 (평균 Δ ${s.avgDelta})</div>
    ${s.topDeltas.slice(0, 8).map(d => `<div class="bar-row"><span class="bar-label">Δ = ${d.delta}</span><div class="bar-track"><div class="bar-fill" style="width:${(d.count / maxD * 100).toFixed(1)}%"></div></div><span class="bar-val">${d.count}회</span></div>`).join('')}
    <div class="divider"></div>
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:8px">AC 복잡도 분포 (평균 ${s.avgAC}, 권장 7~10)</div>
    ${s.acDist.map(a => `<div class="bar-row"><span class="bar-label">AC ${a.ac}</span><div class="bar-track"><div class="bar-fill" style="width:${(a.count / maxAC * 100).toFixed(1)}%;background:${a.ac >= 7 && a.ac <= 10 ? 'var(--ok)' : 'var(--text-muted)'}"></div></div><span class="bar-val">${a.pct}%</span></div>`).join('')}
  `;

  document.getElementById('posDigitView').innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:8px">정렬 위치별 최다 출현 상위 5</div>
    ${s.positional.map((arr, idx) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span class="badge">${idx + 1}번 자리</span>
      ${arr.map(x => renderBall(x.n, true)).join('')}
    </div>`).join('')}
    <div class="divider"></div>
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:8px">끝자리(0~9) 분포</div>
    <div class="btn-row">${s.lastDigits.map(d => `<div class="card-sub" style="padding:6px 10px;text-align:center;min-width:56px"><div style="font-family:var(--mono);font-weight:700">끝${d.digit}</div><div style="font-size:11px;color:var(--text-sub)">${d.pct}%</div></div>`).join('')}</div>
  `;
}

// ─────────────────────────────────────────────
// 탭 6: 내 번호 추적기 & 데이터 동기화
// ─────────────────────────────────────────────
function quickSaveOne(numsStr, btn) {
  const nums = numsStr.split(' ').map(Number).sort((a, b) => a - b);
  const round = (state.context && state.context.latestDrawNo ? state.context.latestDrawNo : estimateLatestDraw()) + 1;
  const tickets = loadTickets();
  tickets.push({ round, nums, savedAt: new Date().toISOString(), result: null });
  saveTickets(tickets);
  renderTicketsView();
  if (btn) { btn.textContent = '저장됨'; btn.disabled = true; }
}

function bulkSaveGenerated(source) {
  const list = source === 'wheel'
    ? state.lastWheelTickets
    : state.lastGenGames.map(g => g.nums);
  if (!list || !list.length) { alert('먼저 번호를 생성하세요.'); return; }
  const round = (state.context && state.context.latestDrawNo ? state.context.latestDrawNo : estimateLatestDraw()) + 1;
  const tickets = loadTickets();
  const now = new Date().toISOString();
  list.forEach(nums => tickets.push({ round, nums: [...nums].sort((a, b) => a - b), savedAt: now, result: null }));
  saveTickets(tickets);
  renderTicketsView();
  alert(`제${round}회차에 ${list.length}게임이 저장되었습니다.`);
}

function saveManualTicket() {
  const r = Number(document.getElementById('saveRound').value);
  const nums = document.getElementById('saveNums').value.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
  const msg = document.getElementById('ticketMsg');
  if (!r || r < 1 || nums.length !== 6 || new Set(nums).size !== 6 || nums.some(n => n < 1 || n > 45)) {
    msg.innerHTML = '<div class="notice notice-warn">회차와 서로 다른 1~45 번호 6개를 정확히 입력하세요.</div>';
    return;
  }
  const tickets = loadTickets();
  tickets.push({ round: r, nums: nums.sort((a, b) => a - b), savedAt: new Date().toISOString(), result: null });
  saveTickets(tickets);
  document.getElementById('saveNums').value = '';
  msg.innerHTML = '<div class="notice notice-ok">번호가 저장되었습니다.</div>';
  renderTicketsView();
}

function deleteTicket(idx) {
  const t = loadTickets();
  t.splice(idx, 1);
  saveTickets(t);
  renderTicketsView();
}

function clearAllTickets() {
  if (!confirm('저장된 모든 번호 기록을 삭제합니까?')) return;
  saveTickets([]);
  renderTicketsView();
}

async function fetchSingleFromApi(drwNo) {
  try {
    const r = await fetch(`https://smok95.github.io/lotto/results/${drwNo}.json`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      if (d && d.draw_no && d.numbers) {
        return { drwNo: Number(d.draw_no), date: String(d.date).slice(0, 10), nums: d.numbers.map(Number).sort((a, b) => a - b), bonus: Number(d.bonus_no) };
      }
    }
  } catch {}
  return null;
}

async function checkAllTickets() {
  const tickets = loadTickets();
  if (!tickets.length) return;
  let mapDirty = false;

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    let draw = state.drawsMap[t.round];
    if (!draw) {
      draw = await fetchSingleFromApi(t.round);
      if (draw) { state.drawsMap[draw.drwNo] = draw; mapDirty = true; }
    }
    if (draw) {
      const gr = LottoEngine.gradeTicket(t.nums, draw.nums, draw.bonus);
      const labels = { 1: '1등', 2: '2등', 3: '3등', 4: '4등', 5: '5등', 0: '낙첨' };
      const matches = t.nums.filter(n => draw.nums.includes(n)).length;
      tickets[i].result = { grade: labels[gr], rank: gr, matches, winNums: draw.nums, bonus: draw.bonus, winDate: draw.date };
    } else {
      tickets[i].result = { grade: '미추첨/조회불가', rank: -1, matches: 0, winNums: [] };
    }
  }
  if (mapDirty) {
    saveLocalDraws(state.drawsMap);
    rebuildStateFromMap(state.drawsMap);
    refreshAllViews();
  }
  saveTickets(tickets);
  renderTicketsView();
}

function renderTicketsView() {
  const tickets = loadTickets();
  const listEl = document.getElementById('ticketList');
  const sumEl = document.getElementById('ticketSummary');
  if (!listEl) return;

  if (!tickets.length) {
    sumEl.innerHTML = '';
    listEl.innerHTML = '<div class="notice">저장된 번호가 없습니다. 스마트 생성이나 축약 휠링에서 저장해 보세요.</div>';
    return;
  }

  const checked = tickets.filter(t => t.result && t.result.winNums && t.result.winNums.length === 6);
  const wins = checked.filter(t => t.result.grade !== '낙첨');
  sumEl.innerHTML = `<div class="btn-row">
    <span class="badge">총 ${tickets.length}게임 저장</span>
    <span class="badge badge-accent">확인 완료 ${checked.length}게임</span>
    <span class="badge badge-ok">당첨 ${wins.length}게임</span>
  </div>`;

  const indexed = tickets.map((t, idx) => ({ t, idx })).sort((a, b) => b.t.round - a.t.round);
  listEl.innerHTML = indexed.map(({ t, idx }) => {
    const r = t.result;
    const badgeCls = !r ? '' : r.grade === '낙첨' || r.grade === '미추첨/조회불가' ? '' : 'badge-ok';
    return `<div class="combo-row">
      <span class="combo-idx">제${t.round}회</span>
      <div class="combo-balls">${renderBalls(t.nums, true)}</div>
      <div class="combo-metrics">
        <span class="badge ${badgeCls}">${r ? `${r.grade} (${r.matches}개)` : '미확인'}</span>
        <button class="btn btn-ghost btn-sm" onclick="deleteTicket(${idx})">삭제</button>
      </div>
    </div>`;
  }).join('');
}

function copySyncLink() {
  const tickets = loadTickets();
  if (!tickets.length) {
    alert('동기화할 저장 번호가 없습니다. 먼저 번호를 저장해 주세요.');
    return;
  }
  // 최근 50개 티켓을 압축 포맷(r:n1,n2,n3,n4,n5,n6)으로 URL 해시에 직렬화
  const compact = tickets.slice(-50).map(t => `${t.round}:${t.nums.join(',')}`).join(';');
  const baseUrl = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'https://roo2001.github.io/lotto/'
    : (location.origin + location.pathname);
  const url = `${baseUrl}#sync=${encodeURIComponent(compact)}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      alert(`휴대폰 동기화 링크가 복사되었습니다 (${Math.min(50, tickets.length)}게임 포함).\n카톡 '나에게 보내기'로 전송해 휴대폰에서 열면 번호가 자동 병합됩니다.`);
    }).catch(() => {
      prompt('아래 링크를 복사해 휴대폰에서 열어주세요:', url);
    });
  } else {
    prompt('아래 링크를 복사해 휴대폰에서 열어주세요:', url);
  }
}

function importFromSyncHash() {
  if (!location.hash || !location.hash.startsWith('#sync=')) return;
  try {
    const raw = decodeURIComponent(location.hash.slice(6));
    const items = raw.split(';').filter(Boolean);
    const tickets = loadTickets();
    const existingKeys = new Set(tickets.map(t => `${t.round}:${t.nums.join(',')}`));
    let added = 0;
    const now = new Date().toISOString();

    items.forEach(item => {
      const [rStr, nStr] = item.split(':');
      const round = Number(rStr);
      const nums = (nStr || '').split(',').map(Number).filter(n => n >= 1 && n <= 45).sort((a, b) => a - b);
      if (round >= 1 && nums.length === 6 && new Set(nums).size === 6) {
        const key = `${round}:${nums.join(',')}`;
        if (!existingKeys.has(key)) {
          tickets.push({ round, nums, savedAt: now, result: null });
          existingKeys.add(key);
          added++;
        }
      }
    });

    if (added > 0) {
      saveTickets(tickets);
      showAutoWinBanner(`휴대폰 동기화 완료: ${added}개 저장 번호가 이 기기에 자동 병합되었습니다.`, 'notice-ok');
    }
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
    console.warn('sync hash parse failed', e);
  }
}

function showAutoWinBanner(html, cls = 'notice-ok') {
  const el = document.getElementById('autoWinBanner');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `<div class="notice ${cls}" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
    <span>${html}</span>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('autoWinBanner').style.display='none'">닫기</button>
  </div>`;
}

// 앱 시작 시 이미 추첨이 끝난 미확인 티켓을 자동 채점
function autoCheckPendingTickets() {
  const tickets = loadTickets();
  if (!tickets.length) return;
  const labels = { 1: '1등', 2: '2등', 3: '3등', 4: '4등', 5: '5등', 0: '낙첨' };
  let newlyChecked = 0;
  let winList = [];

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const draw = state.drawsMap[t.round];
    if (!draw) continue;
    if (!t.result || !t.result.winNums || t.result.winNums.length !== 6) {
      const gr = LottoEngine.gradeTicket(t.nums, draw.nums, draw.bonus);
      const matches = t.nums.filter(n => draw.nums.includes(n)).length;
      tickets[i].result = { grade: labels[gr], rank: gr, matches, winNums: draw.nums, bonus: draw.bonus, winDate: draw.date };
      newlyChecked++;
      if (gr > 0) winList.push(`제${t.round}회 ${labels[gr]}`);
    }
  }

  if (newlyChecked > 0) {
    saveTickets(tickets);
    renderTicketsView();
    if (winList.length > 0) {
      showAutoWinBanner(`<strong>자동 당첨 확인 완료:</strong> 신규 채점 ${newlyChecked}게임 중 <strong>${winList.join(', ')}</strong> 당첨이 확인되었습니다.`, 'notice-ok');
    } else {
      showAutoWinBanner(`<strong>자동 당첨 확인 완료:</strong> 추첨 종료된 ${newlyChecked}게임을 자동 채점했습니다 (결과는 [내 번호 · 데이터] 탭에서 확인).`, 'notice');
    }
  }
}

function exportTicketsJson() {
  const data = { exportedAt: new Date().toISOString(), tickets: loadTickets() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lottopro_tickets_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function importTicketsJson(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const arr = Array.isArray(parsed) ? parsed : parsed.tickets;
      if (!Array.isArray(arr)) throw new Error('형식 오류');
      saveTickets(arr);
      renderTicketsView();
      alert(`${arr.length}개 기록을 복원했습니다.`);
    } catch {
      alert('유효한 JSON 백업 파일이 아닙니다.');
    }
  };
  reader.readAsText(file);
}

async function syncLatestFromApi() {
  const btn = document.getElementById('btnSyncLatest');
  const log = document.getElementById('syncLogMsg');
  if (btn) { btn.disabled = true; btn.textContent = '동기화 중...'; }
  setSyncStatus('loading', '최신 회차 확인 중...');

  const est = estimateLatestDraw();
  const curMax = state.context ? state.context.latestDrawNo : 0;
  let added = 0;

  for (let drwNo = curMax + 1; drwNo <= est; drwNo++) {
    const rec = await fetchSingleFromApi(drwNo);
    if (!rec) break;
    state.drawsMap[rec.drwNo] = rec;
    added++;
  }

  if (added > 0) {
    saveLocalDraws(state.drawsMap);
    saveMeta({ lastUpdated: new Date().toISOString(), latestDraw: Math.max(...Object.keys(state.drawsMap).map(Number)) });
    rebuildStateFromMap(state.drawsMap);
    refreshAllViews();
    setSyncStatus('live', `${added}회차 추가 완료 (총 ${state.drawsList.length}회)`);
    if (log) log.innerHTML = `<div class="notice notice-ok">${added}개 최신 회차를 추가했습니다.</div>`;
  } else {
    setSyncStatus('live', `최신 상태 (${state.drawsList.length}회차)`);
    if (log) log.innerHTML = '<div class="notice">이미 최신 회차까지 반영되어 있습니다.</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '최신 회차 동기화'; }
}

function addManualDraw() {
  const raw = document.getElementById('manualDrawInput').value.trim();
  const msg = document.getElementById('manualDrawMsg');
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length < 7 || parts.some(isNaN)) {
    msg.innerHTML = '<div class="notice notice-warn">회차와 번호 6개(+보너스)를 공백으로 구분해 입력하세요.</div>';
    return;
  }
  const [drwNo, ...rest] = parts;
  const nums = rest.slice(0, 6).sort((a, b) => a - b);
  const bonus = rest[6] || 0;
  if (new Set(nums).size !== 6 || nums.some(n => n < 1 || n > 45)) {
    msg.innerHTML = '<div class="notice notice-warn">1~45 사이의 서로 다른 6개 번호를 입력하세요.</div>';
    return;
  }
  state.drawsMap[drwNo] = { drwNo, date: '수동입력', nums, bonus };
  saveLocalDraws(state.drawsMap);
  rebuildStateFromMap(state.drawsMap);
  refreshAllViews();
  document.getElementById('manualDrawInput').value = '';
  msg.innerHTML = `<div class="notice notice-ok">제${drwNo}회차 데이터를 저장했습니다.</div>`;
}

function resetLocalCache() {
  if (!confirm('로컬 추가 캐시를 초기화하고 draws.json 원본을 다시 로드합니까?')) return;
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(META_KEY);
  reloadDrawsJson();
}

function renderDataPanel() {
  const box = document.getElementById('dataStatusBox');
  const recent = document.getElementById('recentDrawsBox');
  const latest = state.drawsList[state.drawsList.length - 1];
  const first = state.drawsList[0];
  const meta = loadMeta();

  if (box) {
    box.innerHTML = `
      <div class="kv-row"><span>실측 분석 범위</span><span class="kv-val">${first ? `제${first.drwNo}회 ~ 제${latest.drwNo}회` : '없음'}</span></div>
      <div class="kv-row"><span>누적 실측 회차 수</span><span class="kv-val text-accent">${state.drawsList.length.toLocaleString()}회차 (중복 제거 SSOT)</span></div>
      <div class="kv-row"><span>최근 동기화 시각</span><span class="kv-val">${meta.lastUpdated ? new Date(meta.lastUpdated).toLocaleString('ko-KR') : 'draws.json 기본 로드'}</span></div>
    `;
  }
  if (recent) {
    const last10 = state.drawsList.slice(-10).reverse();
    recent.innerHTML = last10.map(d => `
      <div class="combo-row">
        <span class="combo-idx">제${d.drwNo}회</span>
        <div class="combo-balls">${renderBalls(d.nums, true)} <span style="font-size:11px;color:var(--text-muted);margin:0 4px">+</span> ${renderBall(d.bonus, true)}</div>
        <span class="card-meta" style="margin-left:auto">${d.date}</span>
      </div>
    `).join('');
  }
}

function refreshAllViews() {
  renderFairnessView(0);
  renderHotColdView('hot');
  renderDeepAnalytics();
  renderTicketsView();
  renderDataPanel();
}

async function reloadDrawsJson() {
  setSyncStatus('loading', '전체 실측 draws.json 로드 중...');
  const merged = {};
  try {
    const res = await fetch('./draws.json?t=' + Date.now());
    if (res.ok) {
      const json = await res.json();
      Object.entries(json.draws || {}).forEach(([k, v]) => { merged[Number(k)] = v; });
    }
  } catch (e) {
    console.warn('draws.json load error', e);
  }
  // 로컬에 더 최신 회차나 수동 입력이 있으면 보존
  const local = loadLocalDraws();
  Object.entries(local).forEach(([k, v]) => {
    const numK = Number(k);
    if (!merged[numK] && v && v.nums && v.nums.length === 6) merged[numK] = v;
  });

  if (Object.keys(merged).length > 0) {
    saveLocalDraws(merged);
    rebuildStateFromMap(merged);
    const latest = state.drawsList[state.drawsList.length - 1];
    setSyncStatus('live', `실측 ${state.drawsList.length}회차 (최신 제${latest.drwNo}회)`);
  } else {
    setSyncStatus('err', '데이터 로드 실패');
  }
  refreshAllViews();
  autoCheckPendingTickets();
}

// ─────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#mainTabs .tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(Number(btn.dataset.tab)));
  });
  initGenGrid();
  updateStrategyHelp();
  initWheelGrid();
  initValidatorGrid();
  updateWheelInfo();
  importFromSyncHash();
  reloadDrawsJson();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

