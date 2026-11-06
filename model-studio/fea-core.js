// FEA + SIMP topology optimization core (runs inside a Web Worker; also loadable in Node for tests).
// Units: lengths in mm, E in MPa (N/mm^2), forces in N, displacements in mm, stress in MPa.
// 8-node trilinear hexahedral elements on a regular voxel grid, matrix-free PCG solver.

// Everything is wrapped in feaModule() so the page can spawn it as a Blob worker (works from file:// too).
function feaModule() {
'use strict';
function hexKE(nu) {
  // Stiffness matrix of a unit cube (side 1, E = 1). For side h, K = h * KE.
  const c = 1 / ((1 + nu) * (1 - 2 * nu));
  const D = [
    [c * (1 - nu), c * nu, c * nu, 0, 0, 0],
    [c * nu, c * (1 - nu), c * nu, 0, 0, 0],
    [c * nu, c * nu, c * (1 - nu), 0, 0, 0],
    [0, 0, 0, c * (1 - 2 * nu) / 2, 0, 0],
    [0, 0, 0, 0, c * (1 - 2 * nu) / 2, 0],
    [0, 0, 0, 0, 0, c * (1 - 2 * nu) / 2],
  ];
  const KE = new Float64Array(576);
  const g = 1 / Math.sqrt(3);
  const pts = [-g, g];
  for (const xi of pts) for (const et of pts) for (const ze of pts) {
    const B = Bmatrix(xi, et, ze, 1);
    const detJ = 1 / 8; // (h/2)^3 with h = 1, weight 1 per Gauss point
    // KE += B^T D B detJ
    const DB = new Float64Array(6 * 24);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 24; j++) {
      let s = 0; for (let k = 0; k < 6; k++) s += D[i][k] * B[k * 24 + j];
      DB[i * 24 + j] = s;
    }
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
      let s = 0; for (let k = 0; k < 6; k++) s += B[k * 24 + i] * DB[k * 24 + j];
      KE[i * 24 + j] += s * detJ;
    }
  }
  return { KE, D };
}

// Local node order: (0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1)
const NODE_SIGNS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

function Bmatrix(xi, et, ze, h) {
  // Strain-displacement matrix (6x24), Voigt: xx, yy, zz, xy, yz, zx (engineering shear)
  const B = new Float64Array(6 * 24);
  const s = 2 / h;
  for (let a = 0; a < 8; a++) {
    const [xa, ya, za] = NODE_SIGNS[a];
    const dx = 0.125 * xa * (1 + et * ya) * (1 + ze * za) * s;
    const dy = 0.125 * ya * (1 + xi * xa) * (1 + ze * za) * s;
    const dz = 0.125 * za * (1 + xi * xa) * (1 + et * ya) * s;
    const c = 3 * a;
    B[0 * 24 + c] = dx;
    B[1 * 24 + c + 1] = dy;
    B[2 * 24 + c + 2] = dz;
    B[3 * 24 + c] = dy; B[3 * 24 + c + 1] = dx;
    B[4 * 24 + c + 1] = dz; B[4 * 24 + c + 2] = dy;
    B[5 * 24 + c] = dz; B[5 * 24 + c + 2] = dx;
  }
  return B;
}

// Build the FE model from a voxel mask.
// job: { nx, ny, nz, h, solid: Uint8Array(nx*ny*nz), E, nu, supports: [node indices], loads: [{node, fx, fy, fz}], passive: Uint8Array }
function buildModel(job) {
  const { nx, ny, nz, solid } = job;
  const NX = nx + 1, NY = ny + 1;
  const nodeId = (i, j, k) => i + NX * (j + NY * k);
  const nNodes = NX * NY * (nz + 1);
  const active = [];
  for (let e = 0; e < nx * ny * nz; e++) if (solid[e]) active.push(e);
  const nel = active.length;
  const edof = new Int32Array(nel * 24);
  const used = new Uint8Array(nNodes);
  for (let a = 0; a < nel; a++) {
    const e = active[a];
    const i = e % nx, j = Math.floor(e / nx) % ny, k = Math.floor(e / (nx * ny));
    for (let n = 0; n < 8; n++) {
      const [sx, sy, sz] = NODE_SIGNS[n];
      const nid = nodeId(i + (sx > 0 ? 1 : 0), j + (sy > 0 ? 1 : 0), k + (sz > 0 ? 1 : 0));
      used[nid] = 1;
      edof[a * 24 + 3 * n] = 3 * nid;
      edof[a * 24 + 3 * n + 1] = 3 * nid + 1;
      edof[a * 24 + 3 * n + 2] = 3 * nid + 2;
    }
  }
  const ndof = 3 * nNodes;
  const free = new Uint8Array(ndof);
  for (let n = 0; n < nNodes; n++) if (used[n]) free[3 * n] = free[3 * n + 1] = free[3 * n + 2] = 1;
  for (const n of job.supports) free[3 * n] = free[3 * n + 1] = free[3 * n + 2] = 0;
  const F = new Float64Array(ndof);
  for (const L of job.loads) { F[3 * L.node] += L.fx; F[3 * L.node + 1] += L.fy; F[3 * L.node + 2] += L.fz; }
  for (let d = 0; d < ndof; d++) if (!free[d]) F[d] = 0;
  const { KE, D } = hexKE(job.nu);
  return { nel, active, edof, ndof, free, F, KE, D, nNodes };
}

// y = K(x) * u   (stiff[a] = per-element stiffness scale = E_e * h)
function matvec(model, stiff, u, y) {
  const { nel, edof, KE, free } = model;
  y.fill(0);
  const ue = new Float64Array(24);
  for (let a = 0; a < nel; a++) {
    const s = stiff[a];
    const off = a * 24;
    for (let i = 0; i < 24; i++) ue[i] = u[edof[off + i]];
    for (let i = 0; i < 24; i++) {
      let acc = 0; const r = i * 24;
      for (let j = 0; j < 24; j++) acc += KE[r + j] * ue[j];
      y[edof[off + i]] += s * acc;
    }
  }
  for (let d = 0; d < y.length; d++) if (!free[d]) y[d] = 0;
}

function pcg(model, stiff, u, tol, maxIt) {
  const { ndof, edof, KE, free, F, nel } = model;
  // Jacobi preconditioner
  const diag = new Float64Array(ndof);
  for (let a = 0; a < nel; a++) for (let i = 0; i < 24; i++) diag[edof[a * 24 + i]] += stiff[a] * KE[i * 25];
  const Minv = new Float64Array(ndof);
  for (let d = 0; d < ndof; d++) Minv[d] = free[d] && diag[d] > 0 ? 1 / diag[d] : 0;
  for (let d = 0; d < ndof; d++) if (!free[d]) u[d] = 0;
  const r = new Float64Array(ndof), z = new Float64Array(ndof), p = new Float64Array(ndof), q = new Float64Array(ndof);
  matvec(model, stiff, u, q);
  let bnorm = 0;
  for (let d = 0; d < ndof; d++) { r[d] = free[d] ? F[d] - q[d] : 0; bnorm += F[d] * F[d]; }
  bnorm = Math.sqrt(bnorm) || 1;
  for (let d = 0; d < ndof; d++) z[d] = Minv[d] * r[d];
  p.set(z);
  let rz = 0; for (let d = 0; d < ndof; d++) rz += r[d] * z[d];
  let it = 0, res = 1;
  for (; it < maxIt; it++) {
    let rn = 0; for (let d = 0; d < ndof; d++) rn += r[d] * r[d];
    res = Math.sqrt(rn) / bnorm;
    if (res < tol) break;
    matvec(model, stiff, p, q);
    let pq = 0; for (let d = 0; d < ndof; d++) pq += p[d] * q[d];
    if (pq <= 0) break;
    const alpha = rz / pq;
    for (let d = 0; d < ndof; d++) { u[d] += alpha * p[d]; r[d] -= alpha * q[d]; }
    for (let d = 0; d < ndof; d++) z[d] = Minv[d] * r[d];
    let rz2 = 0; for (let d = 0; d < ndof; d++) rz2 += r[d] * z[d];
    const beta = rz2 / rz; rz = rz2;
    for (let d = 0; d < ndof; d++) p[d] = z[d] + beta * p[d];
  }
  return { iterations: it, residual: res };
}

// Element energies and center von Mises stress
function postProcess(model, u, Escale, h) {
  const { nel, edof, KE, D } = model;
  const Bc = Bmatrix(0, 0, 0, h);
  const ce = new Float64Array(nel), vm = new Float64Array(nel);
  const ue = new Float64Array(24);
  for (let a = 0; a < nel; a++) {
    for (let i = 0; i < 24; i++) ue[i] = u[edof[a * 24 + i]];
    let c = 0;
    for (let i = 0; i < 24; i++) { let acc = 0; for (let j = 0; j < 24; j++) acc += KE[i * 24 + j] * ue[j]; c += ue[i] * acc; }
    ce[a] = c;
    if (Escale) {
      const eps = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < 6; k++) { let s = 0; for (let j = 0; j < 24; j++) s += Bc[k * 24 + j] * ue[j]; eps[k] = s; }
      const sg = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < 6; k++) { let s = 0; for (let j = 0; j < 6; j++) s += D[k][j] * eps[j]; sg[k] = s * Escale[a]; }
      const [sx, sy, sz, txy, tyz, tzx] = sg;
      vm[a] = Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (txy * txy + tyz * tyz + tzx * tzx));
    }
  }
  return { ce, vm };
}


function analyze(job) {
  const model = buildModel(job);
  // optional per-element stiffness multiplier over the full grid (used to check a thresholded optimized design)
  const sc = (a) => (job.elemScale ? job.elemScale[model.active[a]] : 1);
  const stiff = new Float64Array(model.nel), Escale = new Float64Array(model.nel);
  for (let a = 0; a < model.nel; a++) { Escale[a] = job.E * sc(a); stiff[a] = Escale[a] * job.h; }
  const u = new Float64Array(model.ndof);
  const sol = pcg(model, stiff, u, 1e-6, job.elemScale ? 20000 : 6000);
  const { vm } = postProcess(model, u, Escale, job.h);
  let compliance = 0; for (let d = 0; d < model.ndof; d++) compliance += model.F[d] * u[d];
  let vmMax = 0, dMax = 0;
  for (let a = 0; a < model.nel; a++) {
    if (sc(a) < 1) continue;
    if (vm[a] > vmMax) vmMax = vm[a];
    for (let n = 0; n < 8; n++) { const d0 = model.edof[a * 24 + 3 * n]; const dd = Math.hypot(u[d0], u[d0 + 1], u[d0 + 2]); if (dd > dMax) dMax = dd; }
  }
  return { active: model.active, vm, vmMax, maxDisp: dMax, compliance, solver: sol, u };
}

// SIMP topology optimization (density filter, optimality criteria). Calls onIter(info) each iteration.
function topopt(job, onIter, shouldStop) {
  const model = buildModel(job);
  const { nel, active } = model;
  const { nx, ny, h, E, volfrac, penal = 3, rmin = 1.5, maxIter = 60 } = job;
  const Emin = E * 1e-9;
  const passive = new Uint8Array(nel);
  if (job.passive) for (let a = 0; a < nel; a++) passive[a] = job.passive[active[a]];
  // filter neighbours (in element units)
  const idx = new Int32Array(nx * ny * job.nz).fill(-1);
  for (let a = 0; a < nel; a++) idx[active[a]] = a;
  const R = Math.ceil(rmin) - 1;
  const Hptr = new Int32Array(nel + 1), Hj = [], Hw = [];
  const Hs = new Float64Array(nel);
  for (let a = 0; a < nel; a++) {
    const e = active[a];
    const i = e % nx, j = Math.floor(e / nx) % ny, k = Math.floor(e / (nx * ny));
    for (let dk = -R; dk <= R; dk++) for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ii = i + di, jj = j + dj, kk = k + dk;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= job.nz) continue;
      const b = idx[ii + nx * (jj + ny * kk)];
      if (b < 0) continue;
      const w = rmin - Math.sqrt(di * di + dj * dj + dk * dk);
      if (w > 0) { Hj.push(b); Hw.push(w); Hs[a] += w; }
    }
    Hptr[a + 1] = Hj.length;
  }
  const HJ = Int32Array.from(Hj), HW = Float64Array.from(Hw);
  const filt = (src, dst) => { for (let a = 0; a < nel; a++) { let s = 0; for (let t = Hptr[a]; t < Hptr[a + 1]; t++) s += HW[t] * src[HJ[t]]; dst[a] = s / Hs[a]; } };

  let x = new Float64Array(nel).fill(volfrac);
  for (let a = 0; a < nel; a++) if (passive[a]) x[a] = 1;
  const xPhys = new Float64Array(nel); filt(x, xPhys);
  for (let a = 0; a < nel; a++) if (passive[a]) xPhys[a] = 1;
  const u = new Float64Array(model.ndof);
  const stiff = new Float64Array(nel);
  const dc = new Float64Array(nel), dv = new Float64Array(nel), tmp = new Float64Array(nel);
  let change = 1, loop = 0, c = 0, c0 = null;
  const targetVol = volfrac * nel;
  while (change > 0.01 && loop < maxIter) {
    if (shouldStop && shouldStop()) break;
    loop++;
    for (let a = 0; a < nel; a++) stiff[a] = (Emin + Math.pow(xPhys[a], penal) * (E - Emin)) * h;
    const sol = pcg(model, stiff, u, 1e-5, 3000);
    const { ce } = postProcess(model, u, null, h);
    c = 0;
    for (let a = 0; a < nel; a++) {
      c += stiff[a] * ce[a];
      dc[a] = -penal * Math.pow(xPhys[a], penal - 1) * (E - Emin) * h * ce[a];
      dv[a] = 1;
    }
    if (c0 === null) c0 = c;
    // density filter chain rule
    for (let a = 0; a < nel; a++) tmp[a] = dc[a] / Hs[a];
    filtT(tmp, dc); for (let a = 0; a < nel; a++) tmp[a] = dv[a] / Hs[a];
    filtT(tmp, dv);
    // OC update
    let l1 = 0, l2 = 1e12;
    const xnew = new Float64Array(nel);
    const move = 0.2;
    while ((l2 - l1) / (l1 + l2) > 1e-4) {
      const lmid = 0.5 * (l2 + l1);
      for (let a = 0; a < nel; a++) {
        if (passive[a]) { xnew[a] = 1; continue; }
        const be = Math.sqrt(Math.max(0, -dc[a]) / (dv[a] * lmid));
        xnew[a] = Math.max(0, Math.max(x[a] - move, Math.min(1, Math.min(x[a] + move, x[a] * be))));
      }
      filt(xnew, xPhys);
      for (let a = 0; a < nel; a++) if (passive[a]) xPhys[a] = 1;
      let vol = 0; for (let a = 0; a < nel; a++) vol += xPhys[a];
      if (vol > targetVol) l1 = lmid; else l2 = lmid;
    }
    change = 0; for (let a = 0; a < nel; a++) change = Math.max(change, Math.abs(xnew[a] - x[a]));
    x = xnew;
    let vol = 0; for (let a = 0; a < nel; a++) vol += xPhys[a];
    onIter && onIter({ loop, compliance: c, compliance0: c0, volume: vol / nel, change, cgIters: sol.iterations, xPhys: Float64Array.from(xPhys), active });
  }
  // filter transpose (H is symmetric in weights, but normalization is applied before)
  function filtT(src, dst) { for (let a = 0; a < nel; a++) { let s = 0; for (let t = Hptr[a]; t < Hptr[a + 1]; t++) s += HW[t] * src[HJ[t]]; dst[a] = s; } }
  return { xPhys, active, compliance: c, compliance0: c0, iterations: loop };
}

const FEA = { hexKE, Bmatrix, buildModel, pcg, analyze, topopt };
if (typeof importScripts === 'function' && typeof self !== 'undefined') {
  let stop = false;
  self.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.cmd === 'stop') { stop = true; return; }
    try {
      if (msg.cmd === 'analyze') {
        const r = analyze(msg.job);
        self.postMessage({ type: 'analysis', result: { active: r.active, vm: r.vm, vmMax: r.vmMax, maxDisp: r.maxDisp, compliance: r.compliance, solver: r.solver } });
      } else if (msg.cmd === 'topopt') {
        stop = false;
        const r = topopt(msg.job, (info) => self.postMessage({ type: 'iter', info }), () => stop);
        self.postMessage({ type: 'topoptDone', result: { iterations: r.iterations, compliance: r.compliance, compliance0: r.compliance0 } });
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  };
}
  return FEA;
}
if (typeof module !== 'undefined' && module.exports) module.exports = feaModule();
