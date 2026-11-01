/*
 * N x N x N 루빅스 큐브 (2 ~ 10) : 상태 + 3D 그리기 + 드래그로 층 돌리기
 *
 * 모든 스티커는 3D 좌표(정수)로 기억한다.
 *  - 층을 돌리면 그 층의 스티커 좌표/방향을 정확히 90도씩 회전시킨다.
 *  - 그림을 입힐 때도 스티커가 "원래 어느 칸의 그림 조각인지"를 들고 다니므로 그대로 따라 움직인다.
 * 좌표는 칸 하나의 폭이 2가 되도록 잡았다. (바깥 면의 위치 = ±N)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NxNCube = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FACES = 'URFDLB';
  const NORM = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1]];
  // 3x3 면 번호 배치(Kociemba)와 같은 방향: 읽는 순서의 오른쪽 / 아래쪽
  const RIGHT = [[1, 0, 0], [0, 0, -1], [1, 0, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  const DOWN = [[0, 0, 1], [0, -1, 0], [0, -1, 0], [0, 0, -1], [0, -1, 0], [0, -1, 0]];
  const COLORS = ['#f8fafc', '#dc2f45', '#17a34a', '#facc15', '#f97316', '#2563eb'];

  // 정수 벡터를 +축 기준 오른손 방향으로 t번(1/4바퀴씩) 회전
  function rot(v, a, t) {
    let x = v[0], y = v[1], z = v[2];
    const k = ((t % 4) + 4) % 4;
    for (let i = 0; i < k; i++) {
      if (a === 0) { const ny = -z, nz = y; y = ny; z = nz; }
      else if (a === 1) { const nx = z, nz = -x; x = nx; z = nz; }
      else { const nx = -y, ny = x; x = nx; y = ny; }
    }
    return [x, y, z];
  }
  // 실수 각도 회전 (애니메이션용)
  function rotf(v, a, th) {
    const c = Math.cos(th), s = Math.sin(th), x = v[0], y = v[1], z = v[2];
    if (a === 0) return [x, y * c - z * s, y * s + z * c];
    if (a === 1) return [x * c + z * s, y, -x * s + z * c];
    return [x * c - y * s, x * s + y * c, z];
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function scaleAdd(p, v, s) { return [p[0] + v[0] * s, p[1] + v[1] * s, p[2] + v[2] * s]; }

  class NxNCube {
    constructor(canvas, hooks) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.hooks = hooks || {};
      this.rx = 25 * Math.PI / 180;
      this.ry = -35 * Math.PI / 180;
      this.tex = [null, null, null, null, null, null];
      this.queue = [];
      this.anim = null;
      this.history = [];
      this.moveCount = 0;
      this.polys = [];
      this.dirty = true;
      this.grab = null;
      this.N = 3;
      this.build(3);
      this._bind();
      this.resize();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    /* ---------- 상태 ---------- */
    build(N) {
      this.N = N;
      this.stickers = [];
      for (let f = 0; f < 6; f++) {
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const p = [0, 0, 0];
            for (let k = 0; k < 3; k++) {
              p[k] = NORM[f][k] * N + RIGHT[f][k] * (2 * c - (N - 1)) + DOWN[f][k] * (2 * r - (N - 1));
            }
            this.stickers.push({ f, r, c, p, n: NORM[f].slice(), rt: RIGHT[f].slice(), dn: DOWN[f].slice() });
          }
        }
      }
      this.queue = [];
      this.anim = null;
      this.history = [];
      this.moveCount = 0;
      this.dirty = true;
      this._changed();
    }
    reset(N) { this.build(N || this.N); }

    get busy() { return !!this.anim || this.queue.length > 0; }

    layerOf(p, a) {
      const v = p[a], N = this.N;
      if (Math.abs(v) === N) return v > 0 ? N - 1 : 0;
      return (v + N - 1) / 2;
    }

    _apply(m) {
      for (const s of this.stickers) {
        if (this.layerOf(s.p, m.a) !== m.i) continue;
        s.p = rot(s.p, m.a, m.t); s.n = rot(s.n, m.a, m.t);
        s.rt = rot(s.rt, m.a, m.t); s.dn = rot(s.dn, m.a, m.t);
      }
    }

    // m = { a:축(0 x,1 y,2 z), i:+축 방향으로 센 층 번호, t:-1|1|2 (+축 기준 오른손 회전) }
    enqueue(m, record) {
      this.queue.push({ a: m.a, i: m.i, t: m.t, rec: record !== false });
      this._busyChanged();
    }
    enqueueAll(list, record) { for (const m of list) this.enqueue(m, record); }
    static inverse(m) { return { a: m.a, i: m.i, t: m.t === 2 ? 2 : -m.t }; }

    undo() {
      if (this.busy || !this.history.length) return false;
      const m = this.history.pop();
      this.moveCount = Math.max(0, this.moveCount - 1);
      this.enqueue(NxNCube.inverse(m), false);
      return true;
    }

    scramble() {
      if (this.busy) return [];
      const N = this.N;
      const count = N === 2 ? 14 : N === 3 ? 22 : 20 + 8 * (N - 3);
      const out = [];
      let last = null;
      const layers = N <= 3 ? [0, N - 1] : null; // 3x3 이하는 바깥 면만 돌려서 섞는다
      while (out.length < count) {
        const a = Math.floor(Math.random() * 3);
        const i = layers ? layers[Math.floor(Math.random() * layers.length)] : Math.floor(Math.random() * N);
        if (last && last.a === a && last.i === i) continue;
        const t = [-1, 1, 2][Math.floor(Math.random() * 3)];
        last = { a, i, t };
        out.push(last);
      }
      this.enqueueAll(out, true);
      return out;
    }

    // 면마다 같은 색이 되어 있나 (그림 방향은 따지지 않음)
    isSolved() {
      const seen = new Map();
      for (const s of this.stickers) {
        const key = s.n.join(',');
        if (!seen.has(key)) seen.set(key, s.f);
        else if (seen.get(key) !== s.f) return false;
      }
      return true;
    }

    // 섞은 기록을 거꾸로 돌리는 풀이
    reverseSolution() {
      return this.history.slice().reverse().map(NxNCube.inverse);
    }
    clearHistory() { this.history = []; this.moveCount = 0; this._changed(); }

    /* ---------- 3x3 풀이기 연결 ---------- */
    // 큐브 전체를 돌려 가운데 조각이 제자리가 되게 한 뒤의 면 색 배열(54글자)을 만든다.
    getFacelets() {
      if (this.N !== 3) return null;
      const centers = [];
      for (const s of this.stickers) {
        if (s.r === 1 && s.c === 1) centers[s.f] = s.n;
      }
      const a = centers[0], b = centers[2];       // 지금 윗면/앞면 가운데가 향한 방향
      const xc = cross(a, b);
      const M = [xc, a, b];                         // 현재 방향 -> 기준 방향
      this._M = M;
      const mul = (v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
      const out = new Array(54).fill('?');
      for (const s of this.stickers) {
        const p = mul(s.p), n = mul(s.n);
        let f = -1;
        for (let k = 0; k < 6; k++) if (NORM[k][0] === n[0] && NORM[k][1] === n[1] && NORM[k][2] === n[2]) f = k;
        const c = (dot(p, RIGHT[f]) + 2) / 2, r = (dot(p, DOWN[f]) + 2) / 2;
        out[f * 9 + r * 3 + c] = FACES[s.f];
      }
      return out.join('');
    }
    // 풀이기가 돌려준 "U R' F2 ..." 를 실제 큐브의 회전으로 바꾼다.
    movesFromNames(names) {
      const M = this._M;
      return names.map((nm) => {
        const f = FACES.indexOf(nm[0]);
        const suf = nm.slice(1);
        const j = NORM[f].findIndex((v) => v !== 0), sg = NORM[f][j];
        // 기준 방향 벡터 -> 실제 방향 벡터 (M 의 전치)
        const v = [M[0][j] * sg, M[1][j] * sg, M[2][j] * sg];
        const a = v.findIndex((x) => x !== 0), s = v[a];
        const cw = -s;                              // 바깥에서 볼 때 시계 방향 = 바깥 방향 기준 -90도
        const t = suf === '2' || suf === "2'" ? 2 : (suf === "'" ? -cw : cw);
        return { a, i: s > 0 ? this.N - 1 : 0, t };
      });
    }

    /* ---------- 그림 ---------- */
    setFaceImage(f, img) {
      if (!img) { this.tex[f] = null; this.dirty = true; return; }
      const size = 600, cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d');
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const side = Math.min(w, h);
      g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
      this.tex[f] = cv;
      this.dirty = true;
    }
    setAllImages(img) { for (let f = 0; f < 6; f++) this.setFaceImage(f, img); }
    clearImages() { for (let f = 0; f < 6; f++) this.tex[f] = null; this.dirty = true; }
    hasImages() { return this.tex.some(Boolean); }

    /* ---------- 그리기 ---------- */
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(240, this.cv.clientWidth), h = Math.max(240, this.cv.clientHeight);
      this.dpr = dpr; this.W = w; this.H = h;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      this.dirty = true;
    }

    _view(v) {
      const m = this._vm;
      const x = v[0] * m.cy + v[2] * m.sy, z = -v[0] * m.sy + v[2] * m.cy;
      return [x, v[1] * m.cx - z * m.sx, v[1] * m.sx + z * m.cx];
    }
    _proj(pv) {
      const k = this._D / (this._D - pv[2]);
      return [this.W / 2 + pv[0] * k * this._S, this.H / 2 - pv[1] * k * this._S, pv[2]];
    }
    // 3D 점(큐브 좌표) -> 화면 점
    project(v) { this._prepView(); return this._proj(this._view(v)); }
    _prepView() {
      this._vm = { cx: Math.cos(this.rx), sx: Math.sin(this.rx), cy: Math.cos(this.ry), sy: Math.sin(this.ry) };
      this._D = this.N * 7;
      this._S = 0.2 * Math.min(this.W, this.H) / this.N;
    }

    draw() {
      const ctx = this.ctx, N = this.N;
      this._prepView();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);

      const an = this.anim;
      let theta = 0;
      if (an) {
        const t = Math.min(1, (an.now - an.t0) / an.dur);
        const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
        theta = an.m.t * (Math.PI / 2) * e;
      }
      const polys = [];
      const gap = N >= 7 ? 0.07 : 0.1, hIn = 1 - gap;

      for (const s of this.stickers) {
        let p = s.p, n = s.n, rt = s.rt, dn = s.dn;
        if (an && this.layerOf(s.p, an.m.a) === an.m.i) {
          p = rotf(p, an.m.a, theta); n = rotf(n, an.m.a, theta);
          rt = rotf(rt, an.m.a, theta); dn = rotf(dn, an.m.a, theta);
        }
        const pv = this._view(p), nv = this._view(n);
        const toCam = [-pv[0], -pv[1], this._D - pv[2]];
        if (dot(nv, toCam) <= 0) continue;
        const rv = this._view(rt), dv = this._view(dn);
        const corner = (h, sr, sd) => this._proj([pv[0] + rv[0] * h * sr + dv[0] * h * sd, pv[1] + rv[1] * h * sr + dv[1] * h * sd, pv[2] + rv[2] * h * sr + dv[2] * h * sd]);
        polys.push({
          type: 's', s, z: pv[2],
          outer: [corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1)],
          inner: [corner(hIn, -1, -1), corner(hIn, 1, -1), corner(hIn, 1, 1), corner(hIn, -1, 1)],
        });
      }

      // 돌아가는 동안 드러나는 단면(검은 판)
      if (an) {
        const a = an.m.a, i = an.m.i, o1 = (a + 1) % 3, o2 = (a + 2) % 3;
        const planes = [];
        if (i > 0) planes.push(2 * i - (N - 1) - 1);
        if (i < N - 1) planes.push(2 * i - (N - 1) + 1);
        for (const pl of planes) {
          for (const moving of [false, true]) {
            const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
              const q = [0, 0, 0]; q[a] = pl; q[o1] = u * N; q[o2] = v * N;
              return this._proj(this._view(moving ? rotf(q, a, theta) : q));
            });
            const c = [0, 0, 0]; c[a] = pl;
            polys.push({ type: 'c', z: this._view(c)[2] - 0.001, pts });
          }
        }
      }

      polys.sort((x, y) => x.z - y.z);
      for (const q of polys) {
        if (q.type === 'c') { this._fill(ctx, q.pts, '#0b0f19'); continue; }
        this._fill(ctx, q.outer, '#0b0f19');
        const s = q.s, tex = this.tex[s.f];
        if (tex) {
          const sw = tex.width / N, TL = q.inner[0], TR = q.inner[1], BL = q.inner[3];
          ctx.save();
          ctx.transform((TR[0] - TL[0]) / sw, (TR[1] - TL[1]) / sw, (BL[0] - TL[0]) / sw, (BL[1] - TL[1]) / sw, TL[0], TL[1]);
          ctx.drawImage(tex, s.c * sw, s.r * sw, sw, sw, 0, 0, sw, sw);
          ctx.restore();
        } else {
          this._fill(ctx, q.inner, COLORS[s.f], true);
        }
      }
      this.polys = polys.filter((q) => q.type === 's');
    }
    _fill(ctx, pts, color, soft) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (soft) { ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); }
    }

    /* ---------- 반복 ---------- */
    _loop(ts) {
      if (!this.anim && this.queue.length) {
        const m = this.queue.shift();
        const q = this.queue.length;
        this.anim = { m, t0: ts, now: ts, dur: q > 15 ? 45 : q > 3 ? 90 : 230 };
      }
      if (this.anim) {
        this.anim.now = ts;
        this.dirty = true;
        if (ts - this.anim.t0 >= this.anim.dur) {
          const m = this.anim.m;
          this._apply(m);
          this.anim = null;
          if (m.rec) { this.history.push({ a: m.a, i: m.i, t: m.t }); this.moveCount++; }
          this._changed();
          if (!this.busy) this._busyChanged();
        }
      }
      if (this.dirty) { this.dirty = false; this.draw(); }
      requestAnimationFrame(this._loop);
    }
    _changed() { if (this.hooks.onChange) this.hooks.onChange(this); }
    _busyChanged() { if (this.hooks.onBusy) this.hooks.onBusy(this.busy, this); }

    /* ---------- 드래그 ---------- */
    _hit(x, y) {
      for (let k = this.polys.length - 1; k >= 0; k--) {
        const pts = this.polys[k].outer;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) return this.polys[k].s;
      }
      return null;
    }
    _localXY(e) {
      const r = this.cv.getBoundingClientRect();
      return [(e.clientX - r.left) * (this.W / r.width), (e.clientY - r.top) * (this.H / r.height)];
    }
    // 드래그한 방향으로 움직이게 되는 층 돌리기
    _moveFromDrag(s, dx, dy) {
      this._prepView();
      const base = this._proj(this._view(s.p));
      const sr = this._proj(this._view(scaleAdd(s.p, s.rt, 1)));
      const sd = this._proj(this._view(scaleAdd(s.p, s.dn, 1)));
      const a1 = [sr[0] - base[0], sr[1] - base[1]], a2 = [sd[0] - base[0], sd[1] - base[1]];
      const l1 = Math.hypot(a1[0], a1[1]) || 1, l2 = Math.hypot(a2[0], a2[1]) || 1;
      const c1 = (dx * a1[0] + dy * a1[1]) / l1, c2 = (dx * a2[0] + dy * a2[1]) / l2;
      let A;
      if (Math.abs(c1) >= Math.abs(c2)) A = s.rt.map((v) => v * Math.sign(c1));
      else A = s.dn.map((v) => v * Math.sign(c2));
      const k = cross(s.n, A);                      // 이 축을 오른손 방향으로 돌리면 스티커가 A 쪽으로 간다
      const a = k.findIndex((v) => v !== 0);
      return { a, i: this.layerOf(s.p, a), t: k[a] > 0 ? 1 : -1 };
    }
    _bind() {
      const cv = this.cv;
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        const [x, y] = this._localXY(e);
        const s = this.busy ? null : this._hit(x, y);
        this.grab = { x, y, s, done: false };
      });
      cv.addEventListener('pointermove', (e) => {
        const g = this.grab;
        if (!g) return;
        const [x, y] = this._localXY(e);
        if (g.s) {
          if (g.done) return;
          if (Math.hypot(x - g.x, y - g.y) > 12) {
            g.done = true;
            this.enqueue(this._moveFromDrag(g.s, x - g.x, y - g.y), true);
          }
        } else {
          this.ry += (x - g.x) * 0.01;
          this.rx = Math.max(-1.45, Math.min(1.45, this.rx + (y - g.y) * 0.01));
          g.x = x; g.y = y;
          this.dirty = true;
        }
      });
      const end = () => { this.grab = null; };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(cv);
    }
  }

  NxNCube.FACES = FACES;
  NxNCube.COLORS = COLORS;
  return NxNCube;
});
