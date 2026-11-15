// Hero 3D turntable: one procedural model per business type.
import * as THREE from '/vendor/three.module.min.js';

const C = {
  orange: 0xf5ae1b, amber: 0xffc94d, red: 0xee3132, blue: 0x53a5db, navy: 0x2b4294,
  cream: 0xfffaf0, paper: 0xefece4, ink: 0x17224f, steel: 0xb8c0c8, water: 0x53a5db,
  sage: 0x86a784, stone: 0x6b6e75, white: 0xffffff
};
const mats = new Map();
const mat = (color, opts = {}) => {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({color, roughness: .55, ...opts}));
  return mats.get(key);
};
function part(geo, material, pos = [0,0,0], rot = [0,0,0], scale) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const group = (...children) => { const g = new THREE.Group(); children.forEach(c => g.add(c)); return g; };
const cyl = (r, h, seg = 40) => new THREE.CylinderGeometry(r, r, h, seg);
const X = [0, 0, Math.PI / 2];

function gym() {
  const steel = mat(C.steel, {metalness: .8, roughness: .3});
  const bell = group(
    part(cyl(.06, 1.5), steel, [0,0,0], X),
    ...[-1, 1].flatMap(s => [
      part(cyl(.4, .13), mat(C.orange), [s * .46, 0, 0], X),
      part(cyl(.31, .1), mat(C.navy), [s * .58, 0, 0], X),
      part(cyl(.1, .08), steel, [s * .68, 0, 0], X)
    ])
  );
  bell.position.set(-.15, .4, -.3);
  bell.rotation.y = .35;
  const kettle = group(
    part(new THREE.SphereGeometry(.33, 40, 28), mat(C.ink, {roughness: .4}), [0,.31,0], [0,0,0], [1,.92,1]),
    part(new THREE.TorusGeometry(.2, .05, 16, 32, Math.PI), mat(C.ink, {roughness: .4}), [0,.56,0]),
    part(cyl(.2, .02), mat(C.orange), [0,.07,0])
  );
  kettle.position.set(.62, 0, .62);
  kettle.rotation.y = -.6;
  const plate = part(cyl(.34, .08), mat(C.blue), [-.85, .35, .55], [0, .5, Math.PI / 2 - .35]);
  return group(bell, kettle, plate);
}

function yoga() {
  const mt = mat(C.blue, {roughness: .8});
  const matFlat = part(new THREE.BoxGeometry(1.7, .04, .78), mt, [-.25, .02, 0]);
  const roll = group(
    part(cyl(.19, .78), mt, [0,0,0], [Math.PI / 2, 0, 0]),
    part(cyl(.09, .79), mat(C.navy, {roughness: .8}), [0,0,0], [Math.PI / 2, 0, 0])
  );
  roll.position.set(.79, .19, 0);
  const blockGeo = new THREE.BoxGeometry(.5, .2, .32);
  const blocks = group(
    part(blockGeo, mat(C.orange, {roughness: .9}), [0,.1,0]),
    part(blockGeo, mat(C.amber, {roughness: .9}), [.03,.3,0], [0,.35,0])
  );
  blocks.position.set(-.45, .04, .75);
  const strap = part(new THREE.TorusGeometry(.16, .025, 10, 40), mat(C.ink), [-.75, .07, -.15], [Math.PI / 2, 0, 0], [1,1.6,1]);
  const g = group(matFlat, roll, blocks, strap);
  g.rotation.y = -.25;
  return g;
}

function pilates() {
  const ball = group(
    part(new THREE.SphereGeometry(.5, 48, 32), mat(C.orange, {roughness: .35}), [0,0,0]),
    part(new THREE.TorusGeometry(.5, .012, 8, 64), mat(C.cream), [0,0,0], [.4, 0, .3])
  );
  ball.position.set(-.35, .5, .05);
  const ring = group(
    part(new THREE.TorusGeometry(.34, .035, 16, 64), mat(C.navy), [0,0,0]),
    ...[-1, 1].map(s => part(new THREE.BoxGeometry(.1, .22, .12), mat(C.cream, {roughness: .9}), [s * .37, 0, 0]))
  );
  ring.position.set(.6, .4, -.25);
  ring.rotation.y = -.7;
  const mini = part(new THREE.SphereGeometry(.17, 32, 20), mat(C.blue, {roughness: .4}), [.55, .17, .65]);
  const pad = part(new THREE.BoxGeometry(1.3, .03, .9), mat(C.paper, {roughness: .9}), [-.2, .015, .1], [0, -.2, 0]);
  return group(pad, ball, ring, mini);
}

let water;
function pool() {
  const tile = mat(C.cream, {roughness: .4});
  const W = 1.9, D = 1.25, H = .38, T = .12;
  const walls = group(
    part(new THREE.BoxGeometry(W, H, T), tile, [0, H / 2, -D / 2]),
    part(new THREE.BoxGeometry(W, H, T), tile, [0, H / 2, D / 2]),
    part(new THREE.BoxGeometry(T, H, D), tile, [-W / 2, H / 2, 0]),
    part(new THREE.BoxGeometry(T, H, D), tile, [W / 2, H / 2, 0]),
    part(new THREE.BoxGeometry(W, .04, D), mat(C.blue), [0, .02, 0])
  );
  const geo = new THREE.PlaneGeometry(W - T, D - T, 32, 20);
  water = part(geo, mat(C.water, {roughness: .12, metalness: .1, transparent: true, opacity: .82}), [0, H - .06, 0], [-Math.PI / 2, 0, 0]);
  water.castShadow = false;
  water.userData.base = Float32Array.from(geo.attributes.position.array);
  const steel = mat(C.steel, {metalness: .85, roughness: .25});
  const rail = x => part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, .12, -D / 2 + .16), new THREE.Vector3(x, .55, -D / 2 + .16),
    new THREE.Vector3(x, .66, -D / 2), new THREE.Vector3(x, .55, -D / 2 - .14)
  ]), 24, .022, 8), steel);
  const ladder = group(rail(.35), rail(.6),
    ...[.2, .34].map(y => part(cyl(.018, .25, 8), steel, [.475, y, -D / 2 + .16], [0, 0, Math.PI / 2])));
  const buoy = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const seg = part(new THREE.TorusGeometry(.22, .075, 14, 10, Math.PI / 4), mat(i % 2 ? C.white : C.orange, {roughness: .5}));
    seg.rotation.z = i * Math.PI / 4;
    buoy.add(seg);
  }
  buoy.position.set(-.55, H + .08, D / 2 - .02);
  buoy.rotation.set(-Math.PI / 2 + .18, 0, 0);
  return group(walls, water, ladder, buoy);
}

let flame;
function spa() {
  const stones = new THREE.Group();
  [[.4, C.stone], [.32, C.ink], [.25, 0x8a8d93], [.18, C.ink]].reduce((y, [r, color], i) => {
    const h = r * .45;
    stones.add(part(new THREE.SphereGeometry(r, 40, 24), mat(color, {roughness: .7}), [i % 2 ? .02 : -.02, y + h, 0], [0, i, .04 * (i % 2 ? 1 : -1)], [1, .45, .88]));
    return y + h * 2 - .01;
  }, 0);
  stones.position.set(-.4, 0, -.05);
  const candle = group(
    part(cyl(.15, .34), mat(C.cream, {roughness: .9}), [0,.17,0]),
    part(cyl(.012, .06, 6), mat(C.ink), [0,.37,0])
  );
  flame = part(new THREE.SphereGeometry(.05, 16, 12), new THREE.MeshBasicMaterial({color: C.amber}), [0,.44,0], [0,0,0], [1,1.8,1]);
  flame.castShadow = false;
  const glow = new THREE.PointLight(0xffa040, 1.2, 2.2, 1.6);
  glow.position.set(0, .5, 0);
  flame.userData.light = glow;
  candle.add(flame, glow);
  candle.position.set(.5, 0, .45);
  const towel = group(
    part(cyl(.17, .62), mat(C.blue, {roughness: 1}), [0,0,0], [0, 0, Math.PI / 2]),
    part(cyl(.08, .63), mat(C.cream, {roughness: 1}), [0,0,0], [0, 0, Math.PI / 2])
  );
  towel.position.set(.45, .17, -.45);
  towel.rotation.y = .4;
  const leafGeo = new THREE.SphereGeometry(.3, 24, 12);
  const leaves = group(
    part(leafGeo, mat(C.sage, {roughness: .6}), [-.05, .03, .62], [0, .6, 0], [1, .06, .35]),
    part(leafGeo, mat(0x6f9470, {roughness: .6}), [-.42, .04, .58], [0, -.4, .05], [.8, .06, .3])
  );
  return group(stones, candle, towel, leaves);
}

const builders = {Gym: gym, Yoga: yoga, Pilates: pilates, 'Bể bơi': pool, Spa: spa};
const ease = {
  out: t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
  in: t => t * t * (2.7 * t - 1.7)
};

const SIZE = 1.35;
export function mount(container) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'low-power'});
  } catch { return null; }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 50);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0xcfc4ae, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {left: -3, right: 3, top: 3, bottom: -3});
  sun.shadow.radius = 4;
  sun.shadow.bias = -.0005;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbfd4ff, .6);
  fill.position.set(-4, 2, -2);
  scene.add(fill);

  const turntable = new THREE.Group();
  const podium = group(
    part(new THREE.CylinderGeometry(1.75, 1.82, .24, 72), mat(C.cream, {roughness: .7}), [0, -.12, 0]),
    part(new THREE.CylinderGeometry(1.83, 1.86, .06, 72), mat(C.orange, {roughness: .5}), [0, -.27, 0]),
    part(new THREE.CylinderGeometry(1.86, 1.9, .2, 72), mat(C.ink, {roughness: .6}), [0, -.4, 0])
  );
  turntable.add(podium);
  scene.add(turntable);

  const cache = new Map();
  let current = null, outgoing = null, swapAt = 0, name = null;
  function setModel(next) {
    if (next === name) return;
    name = next;
    if (!cache.has(next)) cache.set(next, (builders[next] || gym)());
    const model = cache.get(next);
    if (outgoing) turntable.remove(outgoing);
    outgoing = current;
    current = model;
    swapAt = performance.now();
    model.scale.setScalar(still ? SIZE : .001);
    turntable.add(model);
    if (still) { if (outgoing) turntable.remove(outgoing); outgoing = null; }
    wake();
  }

  let spin = 0, velocity = 0, dragging = false, lastX = 0, px = 0, py = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', ev => { dragging = true; lastX = ev.clientX; canvas.setPointerCapture(ev.pointerId); });
  canvas.addEventListener('pointermove', ev => {
    if (!dragging) return;
    velocity = (ev.clientX - lastX) * .01;
    spin += velocity;
    lastX = ev.clientX;
    wake();
  });
  const release = () => { dragging = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  addEventListener('pointermove', ev => { px = ev.clientX / innerWidth - .5; py = ev.clientY / innerHeight - .5; });

  function resize() {
    const {clientWidth: w, clientHeight: h} = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const far = w / h < 1 ? 9.4 : 7.6;
    camera.position.set(0, far * .42, far);
    camera.updateProjectionMatrix();
    wake();
  }
  new ResizeObserver(resize).observe(container);

  let visible = true, frame = 0, last = performance.now();
  function tick(now) {
    frame = 0;
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    if (!still) {
      if (!dragging) { velocity *= .94; spin += velocity + dt * .35; }
      const t = (now - swapAt) / 1000;
      if (outgoing) {
        const k = Math.min(1, t / .3);
        outgoing.scale.setScalar(Math.max(.001, SIZE * (1 - ease.in(k))));
        if (k >= 1) { turntable.remove(outgoing); outgoing = null; }
      }
      if (current) {
        const k = Math.min(1, Math.max(0, (t - .2) / .6));
        current.scale.setScalar(Math.max(.001, SIZE * ease.out(k)));
        current.rotation.y = (1 - k) * -1.2;
      }
      if (water && water.parent && current === water.parent) {
        const pos = water.geometry.attributes.position, base = water.userData.base;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3], y = base[i * 3 + 1];
          pos.array[i * 3 + 2] = Math.sin(x * 5 + now * .002) * .012 + Math.cos(y * 6 + now * .0016) * .01;
        }
        pos.needsUpdate = true;
      }
      if (flame && flame.parent && current?.getObjectById(flame.id)) {
        const f = 1 + Math.sin(now * .013) * .08 + Math.sin(now * .031) * .05;
        flame.scale.set(f, 1.8 * f, f);
        flame.userData.light.intensity = 1.1 * f;
      }
      camera.position.x += (px * 1.2 - camera.position.x) * .05;
    }
    turntable.rotation.y = spin;
    turntable.position.y = still ? 0 : Math.sin(now * .0012) * .04;
    camera.lookAt(0, .3 + py * -.2, 0);
    renderer.render(scene, camera);
    if (!still && visible && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function wake() { if (!frame) frame = requestAnimationFrame(tick); }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); }).observe(container);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  resize();
  return {setModel};
}
