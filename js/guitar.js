// Procedural guitar in "guitar space" G (metres):
//   x = distance from the nut toward the bridge, y = height above fingerboard surface,
//   z = across the neck (low E string 5 at +z, high e string 0 at -z).
import * as THREE from 'three';

export const SCALE = 0.648;          // 25.5" scale length
export const NFRETS = 22;
export const NUT_W = 0.043, END_W = 0.056;     // fingerboard width at nut / last fret
export const SPAN_NUT = 0.035, SPAN_BRIDGE = 0.052; // E-to-e string centre span
export const FB_THICK = 0.006;
export const FRET_H = 0.0012;

export const fretX = n => SCALE * (1 - Math.pow(2, -n / 12));
const X_END = fretX(NFRETS) + 0.008;
export const fbWidth = x => NUT_W + (END_W - NUT_W) * Math.min(Math.max(x, 0), X_END) / X_END;
export const stringZ = (s, x) => {
  const span = SPAN_NUT + (SPAN_BRIDGE - SPAN_NUT) * x / SCALE;
  return span / 2 * (s - 2.5) / 2.5;
};
// string height above the fingerboard surface (action rises toward the bridge)
export const stringY = x => FRET_H + 0.0005 + 0.003 * x / SCALE;
// fingertip contact point for fret f (just behind the fret wire)
export const contactX = f => f <= 0 ? -0.006 : fretX(f) - 0.3 * (fretX(f) - fretX(f - 1));
export const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];

// Wood and skin textures (generated with Higgsfield, see assets/textures/README.md). They only change
// the look: geometry, fret spacing and string positions stay exactly as computed. A texture is applied
// once it has loaded, so a missing file leaves the flat colour in place.
const texLoader = new THREE.TextureLoader();
export function applyTexture(mat, file, { repeat = [1, 1], rotation = 0, tint = 0xffffff } = {}) {
  if (typeof document === 'undefined') return;   // Node (tools/selfcheck.mjs): no images to load
  texLoader.load(new URL('../assets/textures/' + file, import.meta.url).href, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.center.set(0.5, 0.5);
    t.rotation = rotation;
    t.anisotropy = 8;
    mat.map = t;
    mat.color.set(tint);
    mat.needsUpdate = true;
  }, undefined, () => { /* keep the flat colour */ });
}

export function buildGuitar() {
  const g = new THREE.Group();
  g.name = 'guitar';
  const wood = new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.75 });
  const neckMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3c, roughness: 0.6, side: THREE.DoubleSide });
  const top = new THREE.MeshStandardMaterial({ color: 0xd8b07a, roughness: 0.55 });
  const side = new THREE.MeshStandardMaterial({ color: 0x6b3d1e, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 0.9, roughness: 0.25 });
  const pearl = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.3, emissive: 0x222222 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xeee8d5, roughness: 0.4 });
  // fingerboard + bridge: rosewood, grain along the neck (box top face: u = x)
  applyTexture(wood, 'rosewood.jpg');
  // neck back + headstock: mahogany; the cylinder's v runs along the neck, so turn the grain 90 degrees
  applyTexture(neckMat, 'mahogany-neck.jpg', { rotation: Math.PI / 2 });
  // body: extrude UVs are in metres. Top caps: spruce, grain along the body (x); sides: mahogany
  applyTexture(top, 'spruce.jpg', { repeat: [2, 2], rotation: Math.PI / 2 });
  applyTexture(side, 'mahogany.jpg', { repeat: [3, 3] });

  // fingerboard: tapered box, top face at y = 0
  const fbGeo = new THREE.BoxGeometry(X_END + 0.004, FB_THICK, 1, 1, 1, 1);
  fbGeo.translate((X_END + 0.004) / 2 - 0.004, -FB_THICK / 2, 0);
  const p = fbGeo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * fbWidth(p.getX(i)));
  fbGeo.computeVertexNormals();
  const fb = new THREE.Mesh(fbGeo, wood);
  fb.receiveShadow = true;
  g.add(fb);

  // neck back: half-elliptic profile extruded along x, tapered
  const neckLen = 0.36;
  const neckGeo = new THREE.CylinderGeometry(1, 1, neckLen, 24, 1, false, 0, Math.PI);
  neckGeo.rotateZ(Math.PI / 2);        // axis along x
  neckGeo.translate(neckLen / 2, 0, 0);
  const np = neckGeo.attributes.position;
  for (let i = 0; i < np.count; i++) {
    const x = np.getX(i);
    const w = fbWidth(x) / 2;
    const depth = 0.019 + 0.004 * x / neckLen;
    // half cylinder spans y<=0 after rotation? normalise: put the curved side toward -y
    np.setY(i, -Math.abs(np.getY(i)) * depth - FB_THICK);
    np.setZ(i, np.getZ(i) * w);
  }
  neckGeo.computeVertexNormals();
  const neck = new THREE.Mesh(neckGeo, neckMat);
  neck.castShadow = true;
  g.add(neck);

  // frets
  for (let n = 1; n <= NFRETS; n++) {
    const x = fretX(n);
    const fg = new THREE.CylinderGeometry(0.0011, 0.0011, fbWidth(x), 8);
    fg.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(fg, metal);
    m.position.set(x, 0.0001, 0);
    m.scale.set(1, 1, 1);
    g.add(m);
  }
  // nut
  const nut = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.0045, NUT_W), bone);
  nut.position.set(-0.0025, 0.0045 / 2 - 0.0015, 0);
  g.add(nut);

  // inlays
  const dot = new THREE.CircleGeometry(0.0035, 24);
  dot.rotateX(-Math.PI / 2);
  for (const n of [3, 5, 7, 9, 12, 15, 17, 19, 21]) {
    const x = (fretX(n) + fretX(n - 1)) / 2;
    const zs = n === 12 ? [-fbWidth(x) / 4, fbWidth(x) / 4] : [0];
    for (const z of zs) {
      const m = new THREE.Mesh(dot, pearl);
      m.position.set(x, 0.0002, z);
      g.add(m);
    }
  }

  // headstock
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.014, 0.085), neckMat);
  head.position.set(-0.1, -0.012, 0);
  head.rotation.z = -0.22;             // angled back
  head.castShadow = true;
  g.add(head);
  for (let s = 0; s < 6; s++) {
    const side3 = s < 3 ? -1 : 1;
    const k = s < 3 ? s : 5 - s;
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 10), metal);
    const xh = -0.05 - k * 0.045;
    peg.position.set(xh, -0.004 + Math.sin(0.22) * (xh + 0.005), side3 * 0.03);
    g.add(peg);
  }

  // body: figure-8 outline extruded downward (top at y = -0.008)
  const bx0 = 0.31, blen = 0.5;
  const sh = new THREE.Shape();
  const X = u => bx0 + u * blen;
  sh.moveTo(X(0), 0);
  sh.bezierCurveTo(X(0), 0.13, X(0.12), 0.15, X(0.22), 0.14);
  sh.bezierCurveTo(X(0.32), 0.13, X(0.36), 0.115, X(0.42), 0.12);
  sh.bezierCurveTo(X(0.55), 0.13, X(0.62), 0.2, X(0.8), 0.2);
  sh.bezierCurveTo(X(0.95), 0.2, X(1), 0.13, X(1), 0);
  sh.bezierCurveTo(X(1), -0.13, X(0.95), -0.2, X(0.8), -0.2);
  sh.bezierCurveTo(X(0.62), -0.2, X(0.55), -0.13, X(0.42), -0.12);
  sh.bezierCurveTo(X(0.36), -0.115, X(0.32), -0.13, X(0.22), -0.14);
  sh.bezierCurveTo(X(0.12), -0.15, X(0), -0.13, X(0), 0);
  const hole = new THREE.Path();
  const hx = 0.525, hr = 0.045;
  hole.absarc(hx, 0, hr, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const bodyGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 32 });
  // shape (u,v) -> G (x, z); extrude depth -> -y  (rotation about x by +90deg)
  const body = new THREE.Mesh(bodyGeo, [top, side]);
  body.rotation.x = Math.PI / 2;
  body.position.y = -0.011;
  body.receiveShadow = true;
  g.add(body);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x0b0704 });
  const holeDisc = new THREE.Mesh(new THREE.CircleGeometry(hr, 40).rotateX(-Math.PI / 2), holeMat);
  holeDisc.position.set(hx, -0.03, 0);
  g.add(holeDisc);
  const ros = new THREE.Mesh(new THREE.RingGeometry(hr + 0.004, hr + 0.011, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.5 }));
  ros.position.set(hx, -0.0075, 0);
  g.add(ros);

  // bridge + saddle
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.15), wood);
  bridge.position.set(SCALE + 0.008, -0.008 + 0.003, 0);
  g.add(bridge);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.075), bone);
  saddle.position.set(SCALE, stringY(SCALE) - 0.002, 0);
  g.add(saddle);

  // strings: each is a 4-segment polyline (nut -> finger -> fret wire -> mid -> bridge) so it can be
  // pressed down to the fret, pushed sideways for bends and vibrate on its sounding length
  const radii = [0.00028, 0.00036, 0.00048, 0.00062, 0.00078, 0.00095];
  const unit = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  const strings = [];
  for (let s = 0; s < 6; s++) {
    const mat = new THREE.MeshStandardMaterial({
      color: s < 2 ? 0xe8e8e8 : 0xd4b06a, metalness: 0.85, roughness: 0.3,
      emissive: 0xffa040, emissiveIntensity: 0,
    });
    const segs = [];
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(unit, mat); g.add(m); segs.push(m); }
    const str = { s, mat, segs, r: radii[s] * 1.4 };
    layoutString(str, null, 0, 0);
    strings.push(str);
  }
  g.userData.strings = strings;
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function setSeg(m, a, b, r) {
  _b.copy(b).sub(a);
  const len = Math.max(1e-5, _b.length());
  m.position.copy(a).addScaledVector(_b, 0.5);
  m.quaternion.setFromUnitVectors(_up, _b.divideScalar(len));
  m.scale.set(r, len, r);
}
/**
 * pressed: null or {x, y, z, fretX} (finger contact point and the fret wire it pushes the string onto)
 * amp: vibration amplitude (m) of the sounding length, T: time (s)
 */
export function layoutString(str, pressed, amp, T) {
  const s = str.s;
  const A = new THREE.Vector3(-0.002, stringY(0), stringZ(s, 0));
  const B = new THREE.Vector3(SCALE, stringY(SCALE), stringZ(s, SCALE));
  let P, F;
  if (pressed) {
    P = new THREE.Vector3(pressed.x, pressed.y, pressed.z);
    const fx = Math.max(pressed.fretX, pressed.x + 0.002);
    // string rests on the fret wire top, displaced sideways like the finger (bends)
    const zLin = stringZ(s, fx);
    F = new THREE.Vector3(fx, FRET_H + 0.0011 + str.r, zLin + (pressed.z - stringZ(s, pressed.x)) * 0.97);
  } else {
    P = A.clone().lerp(B, 0.02);
    F = A.clone().lerp(B, 0.04);
  }
  const M = F.clone().lerp(B, 0.5);
  if (amp) { M.y += amp * Math.sin(T * 2 * Math.PI * 37 + s * 1.7); M.z += 0.6 * amp * Math.cos(T * 2 * Math.PI * 37 + s); }
  setSeg(str.segs[0], A, P, str.r);
  setSeg(str.segs[1], P, F, str.r);
  setSeg(str.segs[2], F, M, str.r);
  setSeg(str.segs[3], M, B, str.r);
}
