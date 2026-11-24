import { accentVertex, fieldVertex, glowFragment, glowVertex, pointFragment } from './particle-shaders.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const TRAIL_LENGTH = 18;
const FLOW_GUIDES = 8;
const TRAIL_STEP = 1 / 30;
const BURST_LIFETIME = 1.3;
const MOBILE_QUALITY = [[8500, 0.8], [13000, 1], [20000, 1.35], [27000, 1.55], [34000, 1.75]];
const DESKTOP_QUALITY = [[20000, 0.85], [34000, 1.1], [50000, 1.5], [66000, 1.75], [82000, 2]];

function createPoints(THREE, count, vertexShader, uniforms) {
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader: pointFragment,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

function advanceGuide(guide, x, y, rate, delta) {
  // Analytic critically damped response keeps the same inertia across frame rates.
  const offsetX = guide.x - x;
  const offsetY = guide.y - y;
  const stepX = (guide.z + rate * offsetX) * delta;
  const stepY = (guide.w + rate * offsetY) * delta;
  const decay = Math.exp(-rate * delta);
  guide.set(
    x + (offsetX + stepX) * decay,
    y + (offsetY + stepY) * decay,
    (guide.z - rate * stepX) * decay,
    (guide.w - rate * stepY) * decay
  );
}

function monitorFrameRate(onChange) {
  let previous = performance.now();
  let duration = 0;
  let frames = 0;
  let slowWindows = 0;
  let fastWindows = 0;
  let cooldownUntil = previous + 2500;

  return function measure() {
    const now = performance.now();
    const interval = now - previous;
    previous = now;
    if (document.hidden || interval > 250) {
      duration = frames = slowWindows = fastWindows = 0;
      cooldownUntil = now + 2500;
      return;
    }

    duration += interval;
    frames++;
    if (duration < 1500) return;
    const average = duration / frames;
    duration = frames = 0;
    if (now < cooldownUntil) return;

    // Sustained pressure lowers quality. Recovery requires a longer, faster sample.
    slowWindows = average > 22 ? slowWindows + 1 : 0;
    fastWindows = average < 17.8 ? fastWindows + 1 : 0;
    if (slowWindows < 2 && fastWindows < 4) return;
    if (onChange(slowWindows >= 2 ? -1 : 1)) cooldownUntil = now + 4500;
    slowWindows = fastWindows = 0;
  };
}

export async function createParticleField(container) {
  const THREE = await import(THREE_URL);
  const mobile = matchMedia('(pointer: coarse)').matches;
  const quality = mobile ? MOBILE_QUALITY : DESKTOP_QUALITY;
  let qualityIndex = 2;
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 60);
  camera.position.z = 16;

  const trail = Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector4(0, 0, 2, 0));
  const guides = Array.from({ length: FLOW_GUIDES }, () => new THREE.Vector4(0, 0, 0, 0));
  const uniforms = {
    time: { value: 0 },
    rotation: { value: 0 },
    charge: { value: 0 },
    openness: { value: 0 },
    resolution: { value: 1 },
    gain: { value: 1 },
    center: { value: new THREE.Vector2() },
    viewSize: { value: new THREE.Vector2(10, 10) },
    burstAge: { value: BURST_LIFETIME },
    burstPower: { value: 0 },
    burstOrigin: { value: new THREE.Vector2() },
    trail: { value: trail },
    guides: { value: guides }
  };

  const field = createPoints(THREE, quality[quality.length - 1][0], fieldVertex, uniforms);
  const accents = createPoints(THREE, mobile ? 2400 : 4100, accentVertex, uniforms);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms, vertexShader: glowVertex, fragmentShader: glowFragment,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  glow.frustumCulled = false;
  glow.renderOrder = -1;
  scene.add(glow, field, accents);

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const unit = Math.min(width, height) / 10;
    const view = uniforms.viewSize.value.set(width / unit, height / unit);
    camera.left = -view.x * 0.5;
    camera.right = view.x * 0.5;
    camera.bottom = -view.y * 0.5;
    camera.top = view.y * 0.5;
    camera.updateProjectionMatrix();

    const ratio = Math.min(devicePixelRatio || 1, quality[qualityIndex][1]);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    uniforms.resolution.value = ratio * Math.min(1.34, Math.max(0.78, unit / 57));
  }

  function applyQuality() {
    const count = quality[qualityIndex][0];
    field.geometry.setDrawRange(0, count);
    // Protect against a large brightness jump when the draw range changes.
    uniforms.gain.value = (quality[2][0] / count) ** 0.3;
    resize();
  }

  new ResizeObserver(resize).observe(container);
  applyQuality();
  const measure = monitorFrameRate(direction => {
    const next = Math.max(0, Math.min(quality.length - 1, qualityIndex + direction));
    if (next === qualityIndex) return false;
    qualityIndex = next;
    applyQuality();
    return true;
  });

  let armed = false;
  let fistTime = 0;
  let lastTrailTime = -Infinity;
  let trailIndex = 0;
  let tracking = false;
  let speed = 0;

  return function render(time, delta, hand) {
    measure();
    const center = uniforms.center.value;
    const view = uniforms.viewSize.value;
    const x = hand ? (hand.x - 0.5) * view.x * 0.84 : Math.sin(time * 0.53) * view.x * 0.055;
    const y = hand ? (0.5 - hand.y) * view.y * 0.84 : Math.cos(time * 0.64) * view.y * 0.043;
    const ease = 1 - Math.exp(-delta * (hand ? 17 : 3.5));
    const dx = (x - center.x) * ease;
    const dy = (y - center.y) * ease;
    center.x += dx;
    center.y += dy;

    for (let i = 0; i < guides.length; i++) {
      const lag = i / (guides.length - 1);
      advanceGuide(guides[i], x, y, 4.2 + 24 * (1 - lag) ** 2, delta);
    }

    const movement = hand && tracking && delta > 0 ? Math.hypot(dx, dy) / delta : 0;
    const trailStrength = Math.min(1, Math.max(0, (movement - 0.8) / 9));
    speed += (trailStrength - speed) * (1 - Math.exp(-delta * 14));
    if (hand && tracking && speed > 0.035 && time - lastTrailTime >= TRAIL_STEP - delta * 0.3) {
      trail[trailIndex].set(center.x, center.y, 0, speed);
      trailIndex = (trailIndex + 1) % TRAIL_LENGTH;
      lastTrailTime = time;
    }
    tracking = Boolean(hand);
    for (const sample of trail) {
      // Fast samples stay luminous longer and are spaced farther apart in world space.
      sample.z += delta / (0.55 + sample.w * 1.15);
      if (sample.z > 1) sample.w = 0;
    }

    uniforms.burstAge.value = Math.min(BURST_LIFETIME, uniforms.burstAge.value + delta);
    if (uniforms.burstAge.value >= BURST_LIFETIME) uniforms.burstPower.value = 0;
    if (!hand) {
      fistTime = 0;
      armed = false;
    } else if (hand.openness < 0.31) {
      fistTime += delta;
      if (fistTime >= 0.10) armed = true;
    } else {
      fistTime = 0;
      if (armed && hand.openness > 0.72) {
        uniforms.burstOrigin.value.copy(center);
        uniforms.burstAge.value = 0;
        uniforms.burstPower.value = 0.65 + 0.55 * uniforms.charge.value;
        armed = false;
      }
    }

    const targetCharge = hand ? 1 - THREE.MathUtils.smoothstep(hand.openness, 0.19, 0.69) : 0;
    const rate = targetCharge > uniforms.charge.value ? 5.4 : 10;
    uniforms.charge.value += (targetCharge - uniforms.charge.value) * (1 - Math.exp(-delta * rate));
    const targetOpenness = hand ? hand.openness : 0;
    uniforms.openness.value += (targetOpenness - uniforms.openness.value) * (1 - Math.exp(-delta * 6));
    uniforms.time.value = time;
    uniforms.rotation.value += delta * (0.87 + uniforms.charge.value * 5.4);

    accents.visible = uniforms.burstPower.value > 0 || trail.some(sample => sample.w > 0);
    renderer.render(scene, camera);
  };
}
