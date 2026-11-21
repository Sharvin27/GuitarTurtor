// Loop subdivision for a skinned, indexed BufferGeometry (bind pose), so the low-poly WebXR hand
// (1360 vertices) renders as a smooth hand. Positions and skin weights follow Loop's rules; UVs are
// interpolated linearly per face; normals are recomputed smooth across UV seams.
import * as THREE from 'three';

const KEY = 1e5;   // weld positions to 10 micrometres when finding shared vertices across UV seams

export function subdivideSkinned(geometry, levels = 1) {
  let g = geometry;
  for (let i = 0; i < levels; i++) g = loopOnce(g);
  return g;
}

function loopOnce(geo) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const index = geo.index ? geo.index.array : [...Array(pos.count).keys()];

  // 1. weld: vertex -> topological id (shared across UV seams)
  const idOf = new Int32Array(pos.count), P = [], W = [];
  const weld = new Map();
  for (let v = 0; v < pos.count; v++) {
    const k = `${Math.round(pos.getX(v) * KEY)},${Math.round(pos.getY(v) * KEY)},${Math.round(pos.getZ(v) * KEY)}`;
    let id = weld.get(k);
    if (id === undefined) {
      id = P.length; weld.set(k, id);
      P.push(new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)));
      const w = new Map();
      if (si) for (let j = 0; j < 4; j++) { const wt = sw.getComponent(v, j); if (wt > 0) w.set(si.getComponent(v, j), wt); }
      W.push(w);
    }
    idOf[v] = id;
  }
  const faces = [];
  for (let f = 0; f < index.length; f += 3) {
    const c = [index[f], index[f + 1], index[f + 2]];
    faces.push({ v: c.map(x => idOf[x]), uv: c.map(x => uv ? [uv.getX(x), uv.getY(x)] : [0, 0]) });
  }

  // 2. edges with their opposite vertices; vertex neighbours
  const edges = new Map(), nb = P.map(() => new Set()), bnd = P.map(() => []);
  const ek = (a, b) => a < b ? a * 1e7 + b : b * 1e7 + a;
  for (const fc of faces) for (let j = 0; j < 3; j++) {
    const a = fc.v[j], b = fc.v[(j + 1) % 3], o = fc.v[(j + 2) % 3];
    const k = ek(a, b);
    let e = edges.get(k);
    if (!e) { e = { a, b, opp: [] }; edges.set(k, e); }
    e.opp.push(o);
    nb[a].add(b); nb[b].add(a);
  }
  for (const e of edges.values()) if (e.opp.length === 1) { bnd[e.a].push(e.b); bnd[e.b].push(e.a); }

  const mixW = (terms) => {
    const m = new Map();
    for (const [w, k] of terms) for (const [j, x] of w) m.set(j, (m.get(j) || 0) + x * k);
    const top = [...m.entries()].filter(([, x]) => x > 0).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const s = top.reduce((a, [, x]) => a + x, 0) || 1;
    return new Map(top.map(([j, x]) => [j, x / s]));
  };

  // 3. new positions for the original vertices
  const NP = [], NW = [];
  for (let v = 0; v < P.length; v++) {
    if (bnd[v].length >= 2) {
      const [b1, b2] = bnd[v];
      NP.push(P[v].clone().multiplyScalar(0.75).addScaledVector(P[b1], 0.125).addScaledVector(P[b2], 0.125));
      NW.push(mixW([[W[v], 0.75], [W[b1], 0.125], [W[b2], 0.125]]));
    } else {
      const n = nb[v].size, beta = n > 3 ? 3 / (8 * n) : 3 / 16;
      const p = P[v].clone().multiplyScalar(1 - n * beta), terms = [[W[v], 1 - n * beta]];
      for (const u of nb[v]) { p.addScaledVector(P[u], beta); terms.push([W[u], beta]); }
      NP.push(p); NW.push(mixW(terms));
    }
  }
  // 4. edge points
  const edgeId = new Map();
  for (const [k, e] of edges) {
    let p, w;
    if (e.opp.length === 2) {
      p = P[e.a].clone().add(P[e.b]).multiplyScalar(0.375).addScaledVector(P[e.opp[0]], 0.125).addScaledVector(P[e.opp[1]], 0.125);
      w = mixW([[W[e.a], 0.375], [W[e.b], 0.375], [W[e.opp[0]], 0.125], [W[e.opp[1]], 0.125]]);
    } else {
      p = P[e.a].clone().add(P[e.b]).multiplyScalar(0.5);
      w = mixW([[W[e.a], 0.5], [W[e.b], 0.5]]);
    }
    edgeId.set(k, NP.length); NP.push(p); NW.push(w);
  }

  // 5. split faces; output vertices keyed by (topological id, uv)
  const outKey = new Map(), oPos = [], oUv = [], oSi = [], oSw = [], oTopo = [], oIdx = [];
  const vert = (id, u) => {
    const k = `${id}|${Math.round(u[0] * 1e5)},${Math.round(u[1] * 1e5)}`;
    let o = outKey.get(k);
    if (o === undefined) {
      o = oTopo.length; outKey.set(k, o); oTopo.push(id);
      oPos.push(NP[id].x, NP[id].y, NP[id].z); oUv.push(u[0], u[1]);
      const e = [...NW[id].entries()];
      for (let j = 0; j < 4; j++) { oSi.push(e[j] ? e[j][0] : 0); oSw.push(e[j] ? e[j][1] : 0); }
    }
    return o;
  };
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  for (const fc of faces) {
    const [a, b, c] = fc.v, [ua, ub, uc] = fc.uv;
    const ab = edgeId.get(ek(a, b)), bc = edgeId.get(ek(b, c)), ca = edgeId.get(ek(c, a));
    const A = vert(a, ua), B = vert(b, ub), C = vert(c, uc);
    const AB = vert(ab, mid(ua, ub)), BC = vert(bc, mid(ub, uc)), CA = vert(ca, mid(uc, ua));
    oIdx.push(A, AB, CA, AB, B, BC, CA, BC, C, AB, BC, CA);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(oPos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(oUv, 2));
  if (si) {
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(oSi, 4));
    out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(oSw, 4));
  }
  out.setIndex(oIdx);
  // smooth normals across UV seams: accumulate per topological vertex
  const acc = NP.map(() => new THREE.Vector3()), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  for (let f = 0; f < oIdx.length; f += 3) {
    const i0 = oIdx[f], i1 = oIdx[f + 1], i2 = oIdx[f + 2];
    const p0 = NP[oTopo[i0]], p1 = NP[oTopo[i1]], p2 = NP[oTopo[i2]];
    const n = t1.subVectors(p1, p0).cross(t2.subVectors(p2, p0));   // area-weighted
    acc[oTopo[i0]].add(n); acc[oTopo[i1]].add(n); acc[oTopo[i2]].add(n);
  }
  const nrm = [];
  for (const id of oTopo) { const n = acc[id].clone().normalize(); nrm.push(n.x, n.y, n.z); }
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  // keep the original winding/normal orientation
  const n0 = geo.attributes.normal;
  if (n0) {
    const f0 = faces[0], v0 = index[0];
    const orig = new THREE.Vector3(n0.getX(v0), n0.getY(v0), n0.getZ(v0));
    if (orig.dot(acc[f0.v[0]]) < 0) { const na = out.attributes.normal; for (let i = 0; i < na.array.length; i++) na.array[i] *= -1; }
  }
  return out;
}
