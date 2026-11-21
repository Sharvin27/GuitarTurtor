// Rig driver for the WebXR "generic-hand" glTF (MIT, @webxr-input-profiles/assets).
// The glb's 25 joints are flat siblings under "Armature" (WebXR convention: -Z points along the bone
// toward the fingertip, +Y is dorsal/nail side, so local X is the flexion axis).
// We run our own forward kinematics in Armature space and write bone position+quaternion each frame.
import * as THREE from 'three';

export const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const D2R = Math.PI / 180;
// joint limits in degrees: [abduction min,max], MCP flex, PIP flex
const LIMITS = {
  index:  { abd: [-30, 30], mcp: [-20, 95], pip: [0, 110] },
  middle: { abd: [-15, 15], mcp: [-20, 95], pip: [0, 110] },
  ring:   { abd: [-15, 15], mcp: [-20, 95], pip: [0, 110] },
  pinky:  { abd: [-30, 30], mcp: [-20, 95], pip: [0, 110] },
  thumb:  { abd: [-45, 45], mcp: [-25, 60], pip: [-10, 80] }, // CMC abd, CMC flex, MCP flex
};
const DIP_RATIO = 0.66;   // DIP ≈ 2/3 PIP (tendon coupling)
const THUMB_IP_RATIO = 0.8;

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

/** Exact critically damped spring step (stable for any dt). Works on Vector3 or numbers via wrapper. */
export class Spring3 {
  constructor(omega, x = new THREE.Vector3()) { this.w = omega; this.x = x.clone(); this.v = new THREE.Vector3(); }
  snap(g) { this.x.copy(g); this.v.set(0, 0, 0); }
  step(g, dt) {
    const w = this.w, e = Math.exp(-w * dt);
    for (const k of ['x', 'y', 'z']) {
      const d = this.x[k] - g[k], v = this.v[k];
      const c = v + w * d;
      this.x[k] = g[k] + (d + c * dt) * e;
      this.v[k] = (v - w * c * dt) * e;
    }
    return this.x;
  }
}

export class HandRig {
  /**
   * @param {THREE.Object3D} gltfScene  scene of generic-hand-{left|right}.glb
   * @param {'left'|'right'} side
   */
  constructor(gltfScene, side) {
    this.side = side;
    this.root = new THREE.Group();            // lives in guitar space; carries the Armature
    this.root.name = side + 'HandRoot';
    this.root.add(gltfScene);
    this.bones = {};
    gltfScene.traverse(o => {
      if (o.isBone || (o.parent && o.parent.name === 'Armature' && !o.isMesh)) this.bones[o.name] = o;
      if (o.isSkinnedMesh || o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
        o.material = new THREE.MeshStandardMaterial({ color: 0xe2b392, roughness: 0.62, metalness: 0.0 });
      }
    });
    const B = n => this.bones[n];
    this.rest = {};
    for (const [n, b] of Object.entries(this.bones)) this.rest[n] = { p: b.position.clone(), q: b.quaternion.clone() };
    const P = n => this.rest[n].p;
    const axis = (n, i) => new THREE.Vector3().setFromMatrixColumn(new THREE.Matrix4().makeRotationFromQuaternion(this.rest[n].q), i);

    // canonical hand basis in Armature space
    const f = P('middle-finger-phalanx-proximal').clone().sub(P('wrist')).normalize();
    const l = P('index-finger-phalanx-proximal').clone().sub(P('pinky-finger-phalanx-proximal'));
    l.addScaledVector(f, -l.dot(f)).normalize();
    const dorsal = axis('wrist', 1);
    this.chir = Math.sign(new THREE.Vector3().crossVectors(l, f).dot(dorsal)) || 1;
    const n = new THREE.Vector3().crossVectors(l, f).multiplyScalar(this.chir);
    this.basisArm = new THREE.Matrix4().makeBasis(l, n, f);
    this.axesArm = { l, n, f };
    this.anchorArm = P('index-finger-phalanx-proximal').clone().add(P('pinky-finger-phalanx-proximal')).multiplyScalar(0.5);

    // finger chains
    this.chains = {};
    for (const fn of FINGERS) {
      const names = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(k => `${fn}-finger-${k}`);
      this.chains[fn] = this._chain(fn, names, [
        { bone: 1, axis: axis(names[1], 1), sign: 1, param: 0 },   // abduction about dorsal axis
        { bone: 1, axis: axis(names[1], 0), sign: -1, param: 1 },  // MCP flexion
        { bone: 2, axis: axis(names[2], 0), sign: -1, param: 2 },  // PIP flexion
        { bone: 3, axis: axis(names[3], 0), sign: -1, param: 2, ratio: DIP_RATIO }, // DIP coupled
      ]);
    }
    const tn = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
    this.chains.thumb = this._chain('thumb', tn, [
      { bone: 0, axis: axis(tn[0], 1), sign: 1, param: 0 },
      { bone: 0, axis: axis(tn[0], 0), sign: -1, param: 1 },
      { bone: 1, axis: axis(tn[1], 0), sign: -1, param: 2 },
      { bone: 2, axis: axis(tn[2], 0), sign: -1, param: 2, ratio: THUMB_IP_RATIO },
    ]);
    // forearm: a tapered skin-coloured cylinder from just inside the wrist to an elbow point (see setForearm).
    // It hides the open wrist cut of the hand mesh and makes the hand read as attached to an arm.
    const ageo = new THREE.CylinderGeometry(0.03, 0.025, 1, 20, 1, false);  // top = elbow end
    ageo.translate(0, 0.5, 0);
    this.arm = new THREE.Mesh(ageo, new THREE.MeshStandardMaterial({ color: 0xd9a888, roughness: 0.65 }));
    this.arm.castShadow = true;
    this.arm.name = side + 'Forearm';
    this.invPlace = new THREE.Matrix4();
    this.place = new THREE.Matrix4();
  }

  _chain(name, names, dofs) {
    const lim = LIMITS[name];
    return {
      name, names, dofs,
      restP: names.map(n => this.rest[n].p.clone()),
      restQ: names.map(n => this.rest[n].q.clone()),
      theta: [0, name === 'thumb' ? 10 * D2R : 20 * D2R, 30 * D2R],
      lo: [lim.abd[0] * D2R, lim.mcp[0] * D2R, lim.pip[0] * D2R],
      hi: [lim.abd[1] * D2R, lim.mcp[1] * D2R, lim.pip[1] * D2R],
      outP: names.map(() => new THREE.Vector3()),
      outQ: names.map(() => new THREE.Quaternion()),
      err: 0,
    };
  }

  /** forward kinematics; writes chain.outP/outQ (Armature space). returns tip position */
  fk(ch, th) {
    const nb = ch.names.length;
    const R = [];
    let cur = new THREE.Quaternion();
    for (let b = 0; b < nb; b++) {
      if (b > 0) cur = R[b - 1].clone();
      for (const d of ch.dofs) if (d.bone === b) {
        _q.setFromAxisAngle(d.axis, d.sign * th[d.param] * (d.ratio || 1));
        cur.multiply(_q);
      }
      R.push(cur);
    }
    ch.outP[0].copy(ch.restP[0]);
    for (let b = 0; b < nb; b++) {
      if (b > 0) {
        _v.copy(ch.restP[b]).sub(ch.restP[b - 1]).applyQuaternion(R[b - 1]);
        ch.outP[b].copy(ch.outP[b - 1]).add(_v);
      }
      ch.outQ[b].copy(R[b]).multiply(ch.restQ[b]);
    }
    return ch.outP[nb - 1];
  }

  /** IK with warm start; falls back to a few seeds if the warm start lands in a poor local minimum */
  ik(ch, target) {
    const warm = ch.theta.slice();
    let err = this._dls(ch, target, 10);
    if (err < 0.0008) return err;
    let best = ch.theta.slice(), bestErr = err;
    const seeds = ch.name === 'thumb' ? [[0, 0.3, 0.6], [-0.5, 0.3, 0.8], [0.5, 0.2, 0.4]]
      : [[0, 0.7, 1.0], [0, 0.2, 1.6], [0, 1.1, 0.5], [warm[0], 0.5, 1.3]];
    for (const sd of seeds) {
      ch.theta = sd.slice();
      err = this._dls(ch, target, 14);
      if (err < bestErr - 1e-5) { bestErr = err; best = ch.theta.slice(); }
      if (bestErr < 0.0008) break;
    }
    ch.theta = best;
    this.fk(ch, best);
    ch.err = bestErr;
    return bestErr;
  }

  /** damped least squares IK on 3 params toward target (Armature space) */
  _dls(ch, target, iters = 10) {
    const th = ch.theta, h = 1e-4, lam2 = 0.004 * 0.004;
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let e = new THREE.Vector3();
    for (let it = 0; it < iters; it++) {
      const tip = this.fk(ch, th).clone();
      e.copy(target).sub(tip);
      if (e.lengthSq() < 1e-8) break;
      for (let j = 0; j < 3; j++) {
        const t2 = th.slice(); t2[j] += h;
        const p2 = this.fk(ch, t2);
        J[0][j] = (p2.x - tip.x) / h; J[1][j] = (p2.y - tip.y) / h; J[2][j] = (p2.z - tip.z) / h;
      }
      // A = J J^T + lam^2 I ; dθ = J^T A^-1 e
      const A = new THREE.Matrix3();
      const a = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        a.push(J[r][0] * J[c][0] + J[r][1] * J[c][1] + J[r][2] * J[c][2] + (r === c ? lam2 : 0));
      }
      A.set(...a);
      A.invert();
      const y = e.clone().applyMatrix3(A);
      for (let j = 0; j < 3; j++) {
        th[j] += J[0][j] * y.x + J[1][j] * y.y + J[2][j] * y.z;
        th[j] = Math.min(ch.hi[j], Math.max(ch.lo[j], th[j]));
      }
    }
    const tip = this.fk(ch, th);
    ch.err = tip.distanceTo(target);
    return ch.err;
  }

  /**
   * Place the hand in guitar space: knuckle midpoint at anchorG, with G-space finger direction fG and
   * lateral (toward index) lG. Dorsal follows the glb's chirality.
   */
  setPlacement(anchorG, lG, fG) {
    const l = lG.clone().normalize();
    const f = fG.clone().addScaledVector(l, -fG.dot(l)).normalize();
    const n = new THREE.Vector3().crossVectors(l, f).multiplyScalar(this.chir);
    const BG = new THREE.Matrix4().makeBasis(l, n, f);
    const R = BG.multiply(this.basisArm.clone().transpose());
    this.root.quaternion.setFromRotationMatrix(R);
    const off = this.anchorArm.clone().applyQuaternion(this.root.quaternion);
    this.root.position.copy(anchorG).sub(off);
    this.root.updateMatrix();
    this.place.copy(this.root.matrix);
    this.invPlace.copy(this.root.matrix).invert();
  }

  /**
   * General placement: rotate so that Armature-space direction aArm maps onto G-space aG (exactly) and bArm
   * onto bG (as closely as possible), then translate so that Armature point pArm lands on pG.
   */
  setPlacementAlign(aArm, aG, bArm, bG, pArm, pG) {
    const frame = (a, b) => {
      const x = a.clone().normalize();
      const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
      return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
    };
    const R = frame(aG, bG).multiply(frame(aArm, bArm).transpose());
    this.root.quaternion.setFromRotationMatrix(R);
    this.root.position.copy(pG).sub(pArm.clone().applyQuaternion(this.root.quaternion));
    this.root.updateMatrix();
    this.place.copy(this.root.matrix);
    this.invPlace.copy(this.root.matrix).invert();
  }

  /** targets: {index: Vector3 (guitar space), ..., thumb: Vector3} */
  solve(targetsG) {
    const local = new THREE.Vector3();
    for (const [name, tg] of Object.entries(targetsG)) {
      const ch = this.chains[name];
      if (!ch || !tg) continue;
      local.copy(tg).applyMatrix4(this.invPlace);
      this.ik(ch, local);
      this._apply(ch);
    }
  }

  /** set joint parameters directly (FK only) */
  setAngles(name, th) {
    const ch = this.chains[name];
    ch.theta = th.map((v, j) => Math.min(ch.hi[j], Math.max(ch.lo[j], v)));
    this.fk(ch, ch.theta);
    this._apply(ch);
  }

  /** IK toward a target given in Armature space */
  solveLocal(name, targetArm) {
    const ch = this.chains[name];
    this.ik(ch, targetArm);
    this._apply(ch);
  }

  _apply(ch) {
    ch.names.forEach((bn, i) => { const b = this.bones[bn]; b.position.copy(ch.outP[i]); b.quaternion.copy(ch.outQ[i]); });
  }

  /** orient the forearm from the wrist toward a fixed elbow point (guitar space) */
  setForearm(elbowG) {
    const w = this.rest.wrist.p.clone().addScaledVector(this.axesArm.f, 0.012).applyMatrix4(this.place);
    const d = elbowG.clone().sub(w);
    const len = Math.min(0.26, d.length());
    d.normalize();
    this.arm.position.copy(w);
    this.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    this.arm.scale.set(1, len, 1);
  }

  /** current tip position of a chain in guitar space */
  tipG(name) {
    const ch = this.chains[name];
    return ch.outP[ch.outP.length - 1].clone().applyMatrix4(this.place);
  }
}
