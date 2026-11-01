/*
 * 3x3 루빅스 큐브 핵심 모듈 (외부 라이브러리 없음)
 *
 * - 큐브 상태: 조각(cubie) 모델 (모서리 8개 + 가장자리 12개)
 * - 면 색 배열(facelets, 54글자) <-> 조각 모델 변환과 올바른 큐브인지 검증
 * - 회전 18종: U R F D L B 각각 시계(R), 반바퀴(R2), 반시계(R')
 *
 * 면 색 배열 순서(Kociemba 표기): U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9
 * 각 글자는 "그 면의 가운데 칸 색"의 이름이다. (예: U = 윗면 색)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FACES = 'URFDLB';
  const SOLVED = 'U'.repeat(9) + 'R'.repeat(9) + 'F'.repeat(9) + 'D'.repeat(9) + 'L'.repeat(9) + 'B'.repeat(9);

  // 모서리 자리/조각 번호
  const URF = 0, UFL = 1, ULB = 2, UBR = 3, DFR = 4, DLF = 5, DBL = 6, DRB = 7;
  // 가장자리 자리/조각 번호
  const UR = 0, UF = 1, UL = 2, UB = 3, DR = 4, DF = 5, DL = 6, DB = 7, FR = 8, FL = 9, BL = 10, BR = 11;

  const Z8 = [0, 0, 0, 0, 0, 0, 0, 0];
  const Z12 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  // 시계 방향 한 번 돌렸을 때: "i번 자리에는 원래 어느 자리의 조각이 오는가" + 방향 변화
  const BASE = [
    /* U */ { cp: [UBR, URF, UFL, ULB, DFR, DLF, DBL, DRB], co: Z8, ep: [UB, UR, UF, UL, DR, DF, DL, DB, FR, FL, BL, BR], eo: Z12 },
    /* R */ { cp: [DFR, UFL, ULB, URF, DRB, DLF, DBL, UBR], co: [2, 0, 0, 1, 1, 0, 0, 2], ep: [FR, UF, UL, UB, BR, DF, DL, DB, DR, FL, BL, UR], eo: Z12 },
    /* F */ { cp: [UFL, DLF, ULB, UBR, URF, DFR, DBL, DRB], co: [1, 2, 0, 0, 2, 1, 0, 0], ep: [UR, FL, UL, UB, DR, FR, DL, DB, UF, DF, BL, BR], eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0] },
    /* D */ { cp: [URF, UFL, ULB, UBR, DLF, DBL, DRB, DFR], co: Z8, ep: [UR, UF, UL, UB, DF, DL, DB, DR, FR, FL, BL, BR], eo: Z12 },
    /* L */ { cp: [URF, ULB, DBL, UBR, DFR, UFL, DLF, DRB], co: [0, 1, 2, 0, 0, 2, 1, 0], ep: [UR, UF, BL, UB, DR, DF, FL, DB, FR, UL, DL, BR], eo: Z12 },
    /* B */ { cp: [URF, UFL, UBR, DRB, DFR, DLF, ULB, DBL], co: [0, 0, 1, 2, 0, 0, 2, 1], ep: [UR, UF, UL, BR, DR, DF, DL, BL, FR, FL, UB, DB], eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1] },
  ];

  // 면 색 배열 위치 표 (U1=0 ... B9=53)
  const CORNER_FACELET = [
    [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
    [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
  ];
  const CORNER_COLOR = [
    ['U', 'R', 'F'], ['U', 'F', 'L'], ['U', 'L', 'B'], ['U', 'B', 'R'],
    ['D', 'F', 'R'], ['D', 'L', 'F'], ['D', 'B', 'L'], ['D', 'R', 'B'],
  ];
  const EDGE_FACELET = [
    [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52],
    [23, 12], [21, 41], [50, 39], [48, 14],
  ];
  const EDGE_COLOR = [
    ['U', 'R'], ['U', 'F'], ['U', 'L'], ['U', 'B'], ['D', 'R'], ['D', 'F'], ['D', 'L'], ['D', 'B'],
    ['F', 'R'], ['F', 'L'], ['B', 'L'], ['B', 'R'],
  ];

  function identity() {
    return {
      cp: [0, 1, 2, 3, 4, 5, 6, 7], co: Z8.slice(),
      ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: Z12.slice(),
    };
  }

  function clone(c) {
    return { cp: c.cp.slice(), co: c.co.slice(), ep: c.ep.slice(), eo: c.eo.slice() };
  }

  // a 상태에서 b 회전을 한 번 더 적용한 새 상태
  function mul(a, b) {
    const r = identity();
    for (let i = 0; i < 8; i++) {
      r.cp[i] = a.cp[b.cp[i]];
      r.co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
    }
    for (let i = 0; i < 12; i++) {
      r.ep[i] = a.ep[b.ep[i]];
      r.eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
    }
    return r;
  }

  // MOVES[face*3 + k]: k=0 시계, 1 반바퀴, 2 반시계
  const MOVES = [];
  for (let f = 0; f < 6; f++) {
    const m1 = BASE[f];
    const m2 = mul(m1, m1);
    const m3 = mul(m2, m1);
    MOVES.push(m1, m2, m3);
  }

  const SUFFIX = ['', '2', "'"];
  function moveName(m) { return FACES[(m / 3) | 0] + SUFFIX[m % 3]; }
  function inverseMove(m) { return ((m / 3) | 0) * 3 + (2 - (m % 3)); }
  function parseMove(tok) {
    const f = FACES.indexOf(tok[0]);
    if (f < 0) return -1;
    const s = tok.slice(1);
    if (s === '') return f * 3;
    if (s === '2' || s === "2'") return f * 3 + 1;
    if (s === "'") return f * 3 + 2;
    return -1;
  }
  function parseMoves(str) {
    const out = [];
    for (const tok of String(str).trim().split(/\s+/)) {
      if (!tok) continue;
      const m = parseMove(tok);
      if (m < 0) throw new Error('알 수 없는 회전: ' + tok);
      out.push(m);
    }
    return out;
  }

  function applyMove(cube, m) { return mul(cube, MOVES[m]); }
  function applyMoves(cube, list) {
    let c = cube;
    for (const m of list) c = mul(c, MOVES[m]);
    return c;
  }

  function isSolved(c) {
    for (let i = 0; i < 8; i++) if (c.cp[i] !== i || c.co[i] !== 0) return false;
    for (let i = 0; i < 12; i++) if (c.ep[i] !== i || c.eo[i] !== 0) return false;
    return true;
  }

  function toFacelets(c) {
    const f = new Array(54);
    f[4] = 'U'; f[13] = 'R'; f[22] = 'F'; f[31] = 'D'; f[40] = 'L'; f[49] = 'B';
    for (let i = 0; i < 8; i++) {
      const j = c.cp[i], ori = c.co[i];
      for (let n = 0; n < 3; n++) f[CORNER_FACELET[i][(n + ori) % 3]] = CORNER_COLOR[j][n];
    }
    for (let i = 0; i < 12; i++) {
      const j = c.ep[i], ori = c.eo[i];
      f[EDGE_FACELET[i][ori % 2]] = EDGE_COLOR[j][0];
      f[EDGE_FACELET[i][(1 + ori) % 2]] = EDGE_COLOR[j][1];
    }
    return f;
  }

  function parity(p) {
    let inv = 0;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) inv++;
    return inv % 2;
  }

  /*
   * 면 색 배열(문자열 또는 배열) -> 조각 모델
   * 실패하면 { ok:false, code } 를 돌려준다.
   *  code: length | letters | count | center | corner | edge | twist | flip | parity
   */
  function fromFacelets(input) {
    const f = typeof input === 'string' ? input.split('') : Array.from(input);
    if (f.length !== 54) return { ok: false, code: 'length' };
    const counts = {};
    for (const ch of f) {
      if (FACES.indexOf(ch) < 0) return { ok: false, code: 'letters' };
      counts[ch] = (counts[ch] || 0) + 1;
    }
    for (const ch of FACES) if (counts[ch] !== 9) return { ok: false, code: 'count', counts };
    const centers = [f[4], f[13], f[22], f[31], f[40], f[49]];
    for (let i = 0; i < 6; i++) if (centers[i] !== FACES[i]) return { ok: false, code: 'center' };

    const c = identity();
    const seenC = new Array(8).fill(false);
    for (let i = 0; i < 8; i++) {
      const fc = CORNER_FACELET[i].map(k => f[k]);
      let ori = 0;
      for (; ori < 3; ori++) if (fc[ori] === 'U' || fc[ori] === 'D') break;
      if (ori === 3) return { ok: false, code: 'corner' };
      const col1 = fc[(ori + 1) % 3], col2 = fc[(ori + 2) % 3];
      let found = -1;
      for (let j = 0; j < 8; j++) {
        if (col1 === CORNER_COLOR[j][1] && col2 === CORNER_COLOR[j][2] && fc[ori] === CORNER_COLOR[j][0]) { found = j; break; }
      }
      if (found < 0 || seenC[found]) return { ok: false, code: 'corner' };
      seenC[found] = true;
      c.cp[i] = found;
      c.co[i] = ori;
    }
    const seenE = new Array(12).fill(false);
    for (let i = 0; i < 12; i++) {
      const a = f[EDGE_FACELET[i][0]], b = f[EDGE_FACELET[i][1]];
      let found = -1, flip = 0;
      for (let j = 0; j < 12; j++) {
        if (a === EDGE_COLOR[j][0] && b === EDGE_COLOR[j][1]) { found = j; flip = 0; break; }
        if (a === EDGE_COLOR[j][1] && b === EDGE_COLOR[j][0]) { found = j; flip = 1; break; }
      }
      if (found < 0 || seenE[found]) return { ok: false, code: 'edge' };
      seenE[found] = true;
      c.ep[i] = found;
      c.eo[i] = flip;
    }
    if (c.co.reduce((s, v) => s + v, 0) % 3 !== 0) return { ok: false, code: 'twist' };
    if (c.eo.reduce((s, v) => s + v, 0) % 2 !== 0) return { ok: false, code: 'flip' };
    if (parity(c.cp) !== parity(c.ep)) return { ok: false, code: 'parity' };
    return { ok: true, cube: c };
  }

  // 무작위 섞기 순서 (같은 면 연속 금지, 반대면 번갈아 반복 금지)
  function randomScramble(n, rnd) {
    rnd = rnd || Math.random;
    const out = [];
    let last = -1, last2 = -1;
    while (out.length < n) {
      const face = Math.floor(rnd() * 6);
      if (face === last) continue;
      if (last >= 0 && face === last2 && ((face + 3) % 6) === last) continue;
      out.push(face * 3 + Math.floor(rnd() * 3));
      last2 = last; last = face;
    }
    return out;
  }

  return {
    FACES, SOLVED, MOVES, CORNER_FACELET, EDGE_FACELET,
    identity, clone, mul, applyMove, applyMoves, isSolved,
    toFacelets, fromFacelets, parity,
    moveName, inverseMove, parseMove, parseMoves, randomScramble,
  };
});
