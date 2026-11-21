// Performer: turns timeline targets into hand motion (springs + placement + IK) for both hands,
// and computes where each string is pressed / plucked. Shared by the page (main.js) and the
// offline self-check (tools/selfcheck.mjs), so what is measured is what is rendered.
import * as THREE from 'three';
import { contactX, fretX, fbWidth, stringY, stringZ, FRET_H } from './guitar.js';
import { sample, FINGER_KEYS, PLUCK_X } from './timeline.js';
import { Spring3 } from './hand.js';

const D2R = Math.PI / 180;
// fretting-hand placement, fitted offline (node tools/selfcheck.mjs --fit-left) on fingertip error AND
// posture. The old fit (alpha 12, ky 0.025) had the same error but flat knuckles (MCP ~0 deg) and hooked
// fingers (PIP ~89 deg); raising the knuckles gives MCP ~33, PIP ~62 and a more upright fingertip.
export const LEFT = {
  alpha: 16 * D2R,                    // finger direction tilt out of the fingerboard plane
  ky: 0.048,                          // knuckle height above the fingerboard
  kz: focus => 0.035 - 0.006 * focus, // knuckle distance beyond the treble edge, by string focus
  // wrist: the palm frame turns about the knuckle line instead of staying rigid. Ranges come from MediaPipe
  // hand poses on a realistic reference clip (frets 12-22, see PLAN.md "Wrist data"): palm-direction yaw
  // median +2 deg (p10..p90 -8..+5), roll about the finger axis median -2 deg (p10..p90 -10..+9).
  yaw: fret => Math.max(-3, Math.min(5, 0.35 * (fret - 5))) * D2R,      // fingers lean toward the bridge up the neck
  roll: focus => Math.max(-8, Math.min(8, WRIST.rollK * (focus - 1.5))) * D2R, // hand rolls as the fingers reach the bass strings
};
export const WRIST = { on: true, rollK: -2.5 };   // deg of roll per string of reach (sign picked by the self-check: -2.5 and 0 tie, +4 is worse)
// picking-hand placement (fitted offline, see tools/selfcheck.mjs --fit-right)
export const RIGHT = { beta: 35 * D2R, yaw: 25 * D2R, dx: 0.0, ky: 0.06, kz: -0.015 };
export const rightAxes = () => ({
  l: new THREE.Vector3(-Math.cos(RIGHT.yaw), 0, Math.sin(RIGHT.yaw)),
  f: new THREE.Vector3(-Math.sin(RIGHT.yaw) * Math.cos(RIGHT.beta), -Math.sin(RIGHT.beta), -Math.cos(RIGHT.yaw) * Math.cos(RIGHT.beta)),
});
const ELBOW_R = new THREE.Vector3(0.80, 0.10, 0.20);

const OMEGA = { finger: 55, strike: 95, hand: 34, thumb: 18, right: 60, pick: 70 };

export class Performer {
  constructor(left, right) {
    this.left = left; this.right = right;
    this.events = [];
    this.handSpring = new Spring3(OMEGA.hand, new THREE.Vector3(contactX(5), 2.5, 0));
    this.springs = {};
    for (const k of [...FINGER_KEYS, 'thumb']) this.springs[k] = new Spring3(k === 'thumb' ? OMEGA.thumb : OMEGA.finger);
    this.rsprings = {};
    for (const k of ['thumb', 'index', 'middle', 'ring', 'pick']) this.rsprings[k] = new Spring3(k === 'pick' ? OMEGA.pick : OMEGA.right);
    this.anchor = new THREE.Vector3();
    this.pick = { base: new THREE.Vector3(), tip: new THREE.Vector3(), visible: false };
    this.lastState = null;
  }

  setEvents(events) { this.events = events; this.mode = events.mode || 'fingers'; this._pickReady = false; }

  update(T, dt, jumped) {
    const st = sample(this.events, T);
    this.lastState = st;
    const tmp = new THREE.Vector3();

    // ---- fretting hand placement ----
    const ax = 0.5 * (contactX(st.pos) + contactX(st.pos + 3)) - 0.01;
    tmp.set(ax, st.focus ?? this.handSpring.x.y, 0);
    if (jumped) this.handSpring.snap(tmp); else this.handSpring.step(tmp, dt);
    const anchorX = this.handSpring.x.x, focus = this.handSpring.x.y;
    this.anchor.set(anchorX, LEFT.ky, -(fbWidth(anchorX) / 2 + LEFT.kz(focus)));

    const L = this.left;
    if (L) {
      const lH = new THREE.Vector3(-1, 0, 0), fH = new THREE.Vector3(0, Math.sin(LEFT.alpha), Math.cos(LEFT.alpha));
      if (WRIST.on) {
        const fret = -12 * Math.log2(Math.max(1e-3, 1 - anchorX / 0.648));
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), LEFT.yaw(fret));
        lH.applyQuaternion(qYaw); fH.applyQuaternion(qYaw);
        lH.applyAxisAngle(fH, LEFT.roll(focus));
      }
      L.setPlacement(this.anchor, lH, fH);
      const goals = {};
      for (const k of FINGER_KEYS) {
        const g = st.targets[k];
        const sp = this.springs[k];
        sp.w = g.strike ? OMEGA.strike : OMEGA.finger;
        tmp.set(g.x, g.y, g.z);
        if (jumped) sp.snap(tmp); else sp.step(tmp, dt);
        goals[k] = sp.x;
      }
      // thumb pad on the back of the neck, opposite index/middle; it rides further round the back when the
      // fingers work the bass strings (reachable band found offline by IK sweep)
      const u = Math.max(-0.9, Math.min(-0.1, -0.9 + 0.18 * focus)), wN = fbWidth(anchorX - 0.02) / 2;
      tmp.set(anchorX - 0.02, -0.012 - 0.02 * Math.sqrt(1 - u * u), u * wN);
      if (jumped) this.springs.thumb.snap(tmp); else this.springs.thumb.step(tmp, dt);
      goals.thumb = this.springs.thumb.x;
      L.solve(goals);
      L.setForearm(new THREE.Vector3(anchorX + 0.12, -0.13, -0.30));
    }

    // ---- string geometry: pressed points from the *actual* fingertips ----
    const pressed = [null, null, null, null, null, null];
    if (L) for (const k of FINGER_KEYS) {
      const g = st.targets[k];
      if (!(g.press || g.support)) continue;
      const s = g.note ? g.note.s : null;
      const tip = L.tipG(k);
      const sIdx = s ?? nearestString(tip);
      const zStr = stringZ(sIdx, tip.x);
      if (s === null && Math.abs(tip.z - zStr) > 0.0045) continue;
      const h = Math.max(FRET_H + 0.0006, Math.min(stringY(tip.x), tip.y - 0.0016));
      if (h >= stringY(tip.x) - 1e-5) continue;          // not touching yet
      const fret = g.fret ?? Math.ceil(fretIndexAt(tip.x));
      if (!pressed[sIdx] || tip.x > pressed[sIdx].x) pressed[sIdx] = { x: tip.x, y: h, z: tip.z, fretX: fretX(Math.max(1, fret)) };
    }

    // ---- picking hand ----
    const R = this.right;
    this.pick.visible = false;
    if (R) {
      const { l: lR, f: fR } = rightAxes();
      if (this.mode === 'pick') {
        this._pickPose();
        const g = st.right.pick;
        const sp = this.rsprings.pick;
        tmp.set(g.x, g.y, g.z);
        if (jumped) sp.snap(tmp); else sp.step(tmp, dt);
        // orient the grip so the pick points down at the strings, then put the pick tip on the sprung target
        R.setPlacementAlign(this.pickDirArm, new THREE.Vector3(0, -1, 0.25), R.axesArm.f, fR.clone().setY(0), this.pickTipArm, sp.x);
        this.pick.tip.copy(this.pickTipArm).applyMatrix4(R.place);
        this.pick.base.copy(this.pickBaseArm).applyMatrix4(R.place);
        this.pick.visible = true;
      } else {
        const zc = stringZ(2.5, PLUCK_X);
        R.setPlacement(new THREE.Vector3(PLUCK_X + RIGHT.dx, stringY(PLUCK_X) + RIGHT.ky, zc + RIGHT.kz), lR, fR);
        const goals = {};
        for (const k of ['thumb', 'index', 'middle', 'ring']) {
          const g = st.right[k];
          if (!g) continue;
          tmp.set(g.x, g.y, g.z);
          const sp = this.rsprings[k];
          if (jumped) sp.snap(tmp); else sp.step(tmp, dt);
          goals[k] = sp.x;
        }
        // pinky follows the ring finger loosely (coupled), slightly curled
        if (goals.ring) goals.pinky = goals.ring.clone().add(new THREE.Vector3(0.016, 0.008, 0.008));
        R.solve(goals);
      }
      R.setForearm(ELBOW_R);
    }
    return { st, pressed, anchor: this.anchor };
  }

  /** pick grip: index curled, thumb pad on the index distal phalanx, others loosely curled */
  _pickPose() {
    const R = this.right;
    if (this._pickReady) return;
    R.setAngles('middle', [0, 70 * D2R, 85 * D2R]);
    R.setAngles('ring', [0, 75 * D2R, 90 * D2R]);
    R.setAngles('pinky', [0, 80 * D2R, 90 * D2R]);
    R.setAngles('index', [0, 50 * D2R, 75 * D2R]);
    const ich = R.chains.index;
    const dist = ich.outP[3].clone(), tip = ich.outP[4].clone();
    const { l, n } = R.axesArm;
    const pad = dist.clone().lerp(tip, 0.5).addScaledVector(l, 0.009);
    R.solveLocal('thumb', pad);
    const th = R.chains.thumb.outP[3].clone();
    this.pickBaseArm = th.clone().lerp(pad, 0.5);
    // the pick sticks out of the thumb-index pinch, away from the curled fingers
    const palm = new THREE.Vector3();
    for (const k of ['middle', 'ring', 'pinky']) palm.add(R.chains[k].outP[4]).add(R.chains[k].outP[1]);
    palm.multiplyScalar(1 / 6);
    this.pickDirArm = this.pickBaseArm.clone().sub(palm).normalize().addScaledVector(n, -0.6).normalize();
    this.pickTipArm = this.pickBaseArm.clone().addScaledVector(this.pickDirArm, 0.02);
    this._pickReady = true;
  }
}

function nearestString(p) {
  let best = 0, d = Infinity;
  for (let s = 0; s < 6; s++) { const dd = Math.abs(stringZ(s, p.x) - p.z); if (dd < d) { d = dd; best = s; } }
  return best;
}
function fretIndexAt(x) { return -12 * Math.log2(1 - x / 0.648); }
