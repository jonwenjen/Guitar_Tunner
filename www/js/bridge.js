// Floating-bridge compensation (Floyd Rose and other floating tremolos).
//
// On a floating bridge the strings and the springs balance each other. Tightening
// one string tilts the bridge forward a little, which lowers every other string;
// loosening it does the opposite. Tuning string by string therefore never converges
// in one pass.
//
// Model. The bridge tilt follows the net change in string pull, and each string's
// pitch moves with the tilt by its own sensitivity. Writing q_i for string i's share,
// a change of Δ_j cents that you *see* on string j (tilt included) moves string i by
//      R_ij · Δ_j      with   R_ij = −q_i / (1 − q_j)   (i ≠ j),   R_jj = 1.
// (Rank-one coupling through one bridge, assuming similar string pulls.)
//
// Measuring q. Strum, detune one string on purpose (say +30 ¢), strum again. The other
// strings moved by ρ_i = Δ_i / Δ_j = −q_i / (1 − q_j). With m the mean of ρ over the
// other strings and q_j taken as the mean share, q_j = −m / (1 − m) and
// q_i = −ρ_i (1 − q_j).
//
// Planning. With x the current deviations from the targets, the changes Δ you should
// see on each string solve R Δ = −x. Tuning in order, string j should be left at the
// temporary target τ_j = −Σ_{later l} R_jl Δ_l: the strings tuned after it then pull it
// onto pitch.

export const MIN_DETUNE = 8;   // cents: smaller test changes are lost in the noise
export const MAX_DETUNE = 55;  // cents: the strum analysis searches ±60 ¢

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

/**
 * @param {Array<number|null>} before  cents per string before the test change
 * @param {Array<number|null>} after   cents per string after it
 * @param {number} j                   string that was detuned on purpose
 * @returns {{ok:true, q:number[], rho:(number|null)[], dj:number} | {ok:false, reason:string, dj?:number}}
 */
export function estimateBridge(before, after, j) {
  const n = before.length;
  if (before[j] === null || after[j] === null || before[j] === undefined || after[j] === undefined) return { ok: false, reason: 'unread' };
  const dj = after[j] - before[j];
  if (Math.abs(dj) < MIN_DETUNE) return { ok: false, reason: 'small', dj };
  const rho = before.map((b, i) => {
    if (i === j || b === null || b === undefined || after[i] === null || after[i] === undefined) return null;
    return (after[i] - b) / dj;
  });
  const known = rho.filter((r) => r !== null);
  if (known.length < 2) return { ok: false, reason: 'unread', dj };
  const m = mean(known);
  const qj = Math.min(0.6, Math.max(-0.2, -m / (1 - m)));
  const q = rho.map((r, i) => {
    if (i === j || r === null) return qj;
    return Math.min(0.9, Math.max(-0.2, -r * (1 - qj)));
  });
  return { ok: true, q, rho, dj };
}

/** Response matrix: R[i][j] = change on string i per cent seen on string j. */
export function responseMatrix(q) {
  const n = q.length;
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : -q[i] / (1 - q[j]))));
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

/**
 * Plan one pass over the strings.
 * @param {Array<number|null>} x   current deviation of each string from its target, cents
 * @param {number[]} q              bridge shares from estimateBridge
 * @param {number[]} order          strings in the order they will be tuned
 * @returns {{delta:number[], tau:number[]}}  change to make on each string, and the
 *   temporary target (deviation from the final target) to leave it at.
 */
export function planBridge(x, q, order) {
  const n = q.length;
  const R = responseMatrix(q);
  const x0 = x.map((v) => (v === null || v === undefined ? 0 : v));
  const delta = solve(R, x0.map((v) => -v));
  const tau = new Array(n).fill(0);
  order.forEach((j, at) => {
    let s = 0;
    for (const l of order.slice(at + 1)) s += R[j][l] * delta[l];
    tau[j] = -s;
  });
  return { delta, tau };
}

/** Simulate tuning in order, each string stopped at its temporary target (for tests and previews). */
export function simulatePass(x, q, order, tau) {
  const R = responseMatrix(q);
  const y = x.map((v) => (v === null || v === undefined ? 0 : v));
  for (const j of order) {
    const d = tau[j] - y[j];             // what the player changes on string j
    for (let i = 0; i < y.length; i++) y[i] += R[i][j] * d;
  }
  return y;
}
