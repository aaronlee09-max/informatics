/*
 * 3x3 루빅스 큐브 풀이 엔진 (2단계 탐색, 외부 라이브러리 없음)
 *
 * 1단계: 어떤 상태에서든 "윗면/아랫면 + 가운데 줄만 돌려도 풀리는 상태"로 만든다.
 *        (모서리 방향 · 가장자리 방향 · 가운데 줄 가장자리 4개 위치를 맞춤)
 * 2단계: U D R2 L2 F2 B2 열 가지 회전만으로 완성한다.
 * 두 단계 모두 "표(이동 표 + 최소 거리 표)"를 만들어 두고 IDA* 로 탐색한다.
 *
 * 이 파일은 웹 워커로도, 일반 스크립트로도, Node 로도 불러올 수 있다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cube-core.js'));
  } else {
    if (typeof importScripts === 'function' && !root.CubeCore) importScripts('cube-core.js');
    root.CubeSolver = factory(root.CubeCore);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const N_TWIST = 2187, N_FLIP = 2048, N_SLICE = 495, N_PERM8 = 40320, N_SPERM = 24;

  // ---------- 좌표 (조각 상태 <-> 번호) ----------
  function twistOf(c) { let t = 0; for (let i = 0; i < 7; i++) t = t * 3 + c.co[i]; return t; }
  function cubeFromTwist(t) {
    const c = C.identity(); let sum = 0;
    for (let i = 6; i >= 0; i--) { c.co[i] = t % 3; sum += c.co[i]; t = (t / 3) | 0; }
    c.co[7] = (3 - (sum % 3)) % 3;
    return c;
  }
  function flipOf(c) { let f = 0; for (let i = 0; i < 11; i++) f = f * 2 + c.eo[i]; return f; }
  function cubeFromFlip(f) {
    const c = C.identity(); let sum = 0;
    for (let i = 10; i >= 0; i--) { c.eo[i] = f % 2; sum += c.eo[i]; f = (f / 2) | 0; }
    c.eo[11] = sum % 2;
    return c;
  }

  // 가운데 줄 가장자리 4개(FR FL BL BR)가 12자리 중 어디에 있는가 (495가지)
  const SLICE_IDX = new Int16Array(4096).fill(-1);
  const SLICE_MASK = [];
  for (let m = 0; m < 4096; m++) {
    let bits = 0;
    for (let b = 0; b < 12; b++) if ((m >> b) & 1) bits++;
    if (bits === 4) { SLICE_IDX[m] = SLICE_MASK.length; SLICE_MASK.push(m); }
  }
  const SLICE_IDENT = SLICE_IDX[0xF00];
  function sliceOf(c) { let m = 0; for (let i = 0; i < 12; i++) if (c.ep[i] >= 8) m |= 1 << i; return SLICE_IDX[m]; }
  function cubeFromSlice(s) {
    const c = C.identity(); const mask = SLICE_MASK[s];
    let a = 8, b = 0;
    for (let i = 0; i < 12; i++) c.ep[i] = ((mask >> i) & 1) ? a++ : b++;
    return c;
  }

  function encodePerm(a, n) {
    let idx = 0;
    for (let i = 0; i < n - 1; i++) {
      let cnt = 0;
      for (let j = i + 1; j < n; j++) if (a[j] < a[i]) cnt++;
      idx = idx * (n - i) + cnt;
    }
    return idx;
  }
  function decodePerm(idx, n) {
    const digits = new Array(n).fill(0);
    for (let i = n - 2; i >= 0; i--) { const r = n - i; digits[i] = idx % r; idx = (idx / r) | 0; }
    const avail = []; for (let i = 0; i < n; i++) avail.push(i);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = avail.splice(digits[i], 1)[0];
    return out;
  }
  function cpermOf(c) { return encodePerm(c.cp, 8); }
  function cubeFromCperm(i) { const c = C.identity(); c.cp = decodePerm(i, 8); return c; }
  function epermOf(c) { return encodePerm(c.ep.slice(0, 8), 8); }
  function cubeFromEperm(i) { const c = C.identity(); const p = decodePerm(i, 8); for (let k = 0; k < 8; k++) c.ep[k] = p[k]; return c; }
  function spermOf(c) { return encodePerm(c.ep.slice(8, 12).map((x) => x - 8), 4); }
  function cubeFromSperm(i) { const c = C.identity(); const p = decodePerm(i, 4); for (let k = 0; k < 4; k++) c.ep[8 + k] = 8 + p[k]; return c; }

  // ---------- 이동 표 / 거리 표 ----------
  function buildMoveTable(n, decode, encode, moves) {
    const nm = moves.length;
    const t = new Int32Array(n * nm);
    for (let i = 0; i < n; i++) {
      const base = decode(i);
      for (let k = 0; k < nm; k++) t[i * nm + k] = encode(C.mul(base, C.MOVES[moves[k]]));
    }
    return t;
  }
  function buildPrune(na, nb, ma, mb, nm, startA, startB) {
    const size = na * nb;
    const dist = new Int8Array(size).fill(-1);
    const queue = new Int32Array(size);
    let head = 0, tail = 0;
    const s0 = startA * nb + startB;
    dist[s0] = 0; queue[tail++] = s0;
    while (head < tail) {
      const s = queue[head++];
      const a = (s / nb) | 0, b = s - a * nb, d = dist[s] + 1;
      for (let m = 0; m < nm; m++) {
        const ns = ma[a * nm + m] * nb + mb[b * nm + m];
        if (dist[ns] < 0) { dist[ns] = d; queue[tail++] = ns; }
      }
    }
    return dist;
  }

  const ALL_MOVES = []; for (let i = 0; i < 18; i++) ALL_MOVES.push(i);
  // 2단계에서 쓰는 열 가지: U U2 U' / D D2 D' / R2 L2 F2 B2  (번호 = 면*3 + 0,1,2)
  const P2_MOVES = [0, 1, 2, 9, 10, 11, 4, 13, 7, 16];

  let T = null;
  function ensureTables() {
    if (T) return T;
    const t0 = Date.now();
    const t = {};
    t.twist = buildMoveTable(N_TWIST, cubeFromTwist, twistOf, ALL_MOVES);
    t.flip = buildMoveTable(N_FLIP, cubeFromFlip, flipOf, ALL_MOVES);
    t.slice = buildMoveTable(N_SLICE, cubeFromSlice, sliceOf, ALL_MOVES);
    t.pruneFlipSlice = buildPrune(N_FLIP, N_SLICE, t.flip, t.slice, 18, 0, SLICE_IDENT);
    t.pruneTwistSlice = buildPrune(N_TWIST, N_SLICE, t.twist, t.slice, 18, 0, SLICE_IDENT);
    t.cperm = buildMoveTable(N_PERM8, cubeFromCperm, cpermOf, P2_MOVES);
    t.eperm = buildMoveTable(N_PERM8, cubeFromEperm, epermOf, P2_MOVES);
    t.sperm = buildMoveTable(N_SPERM, cubeFromSperm, spermOf, P2_MOVES);
    t.pruneCpermSperm = buildPrune(N_PERM8, N_SPERM, t.cperm, t.sperm, 10, 0, 0);
    t.pruneEpermSperm = buildPrune(N_PERM8, N_SPERM, t.eperm, t.sperm, 10, 0, 0);
    t.buildMs = Date.now() - t0;
    T = t;
    return T;
  }

  // ---------- 탐색 ----------
  function skipMove(face, lastFace) {
    return face === lastFace || (lastFace >= 3 && face === lastFace - 3);
  }

  function solveCube(cube, opts) {
    opts = opts || {};
    const maxLen = opts.maxLen || 30;      // 허용하는 최대 길이
    const goodLen = opts.goodLen || 22;    // 이 길이 이하면 바로 종료
    const improveMs = opts.improveMs || 600; // 첫 풀이 후 더 짧은 풀이를 찾아보는 시간
    const hardMs = opts.hardMs || 10000;   // 풀이를 못 찾을 때 포기하는 시간
    const tb = ensureTables();
    const t0 = Date.now();

    if (C.isSolved(cube)) return [];

    let best = null, stopAt = 0;
    const path1 = [];
    const path2 = [];

    function search2(c, e, s, depth, lastFace) {
      if (depth === 0) return c === 0 && e === 0 && s === 0;
      const h1 = tb.pruneCpermSperm[c * N_SPERM + s], h2 = tb.pruneEpermSperm[e * N_SPERM + s];
      if (h1 > depth || h2 > depth || h1 < 0 || h2 < 0) return false;
      for (let k = 0; k < 10; k++) {
        const m = P2_MOVES[k], face = (m / 3) | 0;
        if (skipMove(face, lastFace)) continue;
        path2.push(m);
        if (search2(tb.cperm[c * 10 + k], tb.eperm[e * 10 + k], tb.sperm[s * 10 + k], depth - 1, face)) return true;
        path2.pop();
      }
      return false;
    }

    function tryPhase2() {
      const limit = (best ? best.length - 1 : maxLen) - path1.length;
      if (limit >= 0) {
        const c1 = C.applyMoves(cube, path1);
        const c = cpermOf(c1), e = epermOf(c1), s = spermOf(c1);
        const last = path1.length ? ((path1[path1.length - 1] / 3) | 0) : -1;
        for (let d2 = 0; d2 <= limit; d2++) {
          path2.length = 0;
          if (search2(c, e, s, d2, last)) {
            best = path1.concat(path2);
            if (!stopAt) stopAt = Date.now() + improveMs;
            break;
          }
        }
      }
      if (best && best.length <= goodLen) return true;
      return Date.now() > (stopAt || t0 + hardMs);
    }

    function search1(tw, fl, sl, depth, lastFace) {
      if (depth === 0) {
        if (tw === 0 && fl === 0 && sl === SLICE_IDENT) return tryPhase2();
        return false;
      }
      const h = Math.max(tb.pruneFlipSlice[fl * N_SLICE + sl], tb.pruneTwistSlice[tw * N_SLICE + sl]);
      if (h > depth) return false;
      for (let m = 0; m < 18; m++) {
        const face = (m / 3) | 0;
        if (skipMove(face, lastFace)) continue;
        path1.push(m);
        const r = search1(tb.twist[tw * 18 + m], tb.flip[fl * 18 + m], tb.slice[sl * 18 + m], depth - 1, face);
        path1.pop();
        if (r) return true;
      }
      return false;
    }

    const tw0 = twistOf(cube), fl0 = flipOf(cube), sl0 = sliceOf(cube);
    for (let d1 = 0; d1 <= 14; d1++) {
      if (best && d1 >= best.length) break;
      if (search1(tw0, fl0, sl0, d1, -1)) break;
      if (!best && Date.now() > t0 + hardMs) break;
    }
    if (!best) throw new Error('시간 안에 풀이를 찾지 못했어요');
    return best;
  }

  // 면 색 배열 -> 풀이 (회전 이름 배열)
  function solveFacelets(facelets, opts) {
    const r = C.fromFacelets(facelets);
    if (!r.ok) return { ok: false, code: r.code, counts: r.counts };
    const t0 = Date.now();
    const moves = solveCube(r.cube, opts);
    const check = C.applyMoves(r.cube, moves);
    if (!C.isSolved(check)) throw new Error('내부 오류: 풀이 검산 실패');
    return { ok: true, moves: moves.map(C.moveName), ms: Date.now() - t0 };
  }

  return { ensureTables, solveCube, solveFacelets, P2_MOVES, SLICE_COUNT: SLICE_MASK.length, SLICE_IDENT };
});

// ---------- 웹 워커 진입점 ----------
if (typeof importScripts === 'function' && typeof module === 'undefined') {
  (function () {
    const S = self.CubeSolver;
    S.ensureTables();
    self.postMessage({ type: 'ready' });
    self.onmessage = function (ev) {
      const msg = ev.data || {};
      if (msg.type !== 'solve') return;
      try {
        const res = S.solveFacelets(msg.facelets);
        self.postMessage(Object.assign({ type: 'result', id: msg.id }, res));
      } catch (err) {
        self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
      }
    };
  })();
}
