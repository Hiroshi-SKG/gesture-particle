const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

export async function createParticleField(container) {
  const THREE = await import(THREE_URL);
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ alpha: true, powerPreference: 'low-power' });
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 70);
  camera.position.z = 15;

  const count = mobile ? 6500 : 16000;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // A dense, tapering ribbon suspended among more distant points.
    const index = i * 3;
    positions[index] = Math.random() * 2 - 1;
    positions[index + 1] = Math.random() * 2 - 1;
    positions[index + 2] = Math.random() * 2 - 1;
    seeds[index] = Math.random();
    seeds[index + 1] = Math.random();
    seeds[index + 2] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: { value: 0 },
      density: { value: 1 },
      spread: { value: 1 },
      center: { value: new THREE.Vector2() }
    },
    vertexShader: `
      attribute vec3 seed;
      uniform float time, density, spread;
      uniform vec2 center;
      varying vec3 tint;
      varying float shine;
      void main() {
        float x = position.x;
        float t = time * 0.36;
        float width = 0.4 + 0.6 * (1.0 - abs(x));
        float roll = 4.5 * x + t * 0.7;
        float fiber = position.y * width;
        vec3 point = vec3(
          x * 6.6 + 0.27 * sin(6.0 * x + t),
          1.23 * sin(3.9 * x + t) + x * 0.9 + fiber * (0.45 + 1.0 * sin(roll) * sin(roll)),
          2.2 * cos(3.4 * x + t) + position.z * 0.38 + fiber * cos(roll)
        );
        point += 0.09 * sin(vec3(3.0, 4.0, 5.0) * (seed.y * 6.0 + x) + t);
        float hue = smoothstep(-0.68, 0.78, x + fiber * 0.35);
        tint = mix(vec3(0.44, 0.13, 1.0), vec3(0.08, 0.77, 1.0), hue);
        tint = mix(tint, vec3(0.83, 0.81, 1.0), pow(seed.z, 9.0) * 0.86);
        shine = 0.20 + 0.49 * pow(seed.z, 3.0);
        float size = 1.05 + 3.3 * pow(seed.x, 7.0);
        if (seed.y > 0.86) {
          point = position * vec3(8.9, 4.4, 3.8);
          point.y += 0.22 * sin(t + seed.x * 12.0);
          shine *= 0.46;
          size *= 0.79;
        }
        point *= spread;
        point.xy += center;
        vec4 viewPoint = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * viewPoint;
        gl_PointSize = size * density * 15.0 / -viewPoint.z;
      }
    `,
    fragmentShader: `
      varying vec3 tint;
      varying float shine;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float glow = exp(-4.8 * radius * radius) * (1.0 - smoothstep(0.72, 1.0, radius));
        gl_FragColor = vec4(tint, glow * shine);
      }
    `
  });

  const cloud = new THREE.Points(geometry, material);
  cloud.frustumCulled = false;
  scene.add(cloud);

  function resize() {
    const { clientWidth: width, clientHeight: height } = container;
    const ratio = Math.min(devicePixelRatio || 1, mobile ? 1.35 : 1.75);
    camera.aspect = width / Math.max(height, 1);
    camera.zoom = Math.min(1, camera.aspect / 1.65);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    material.uniforms.density.value = ratio;
  }

  new ResizeObserver(resize).observe(container);
  resize();

  return function render(time, delta, hand) {
    const uniforms = material.uniforms;
    const ease = 1 - Math.exp(-delta * 8);
    const height = 2 * camera.position.z * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
    const x = hand ? (hand.x - 0.5) * height * camera.aspect * 0.85 : 0;
    const y = hand ? (0.5 - hand.y) * height * 0.85 : 0;
    const spread = hand ? THREE.MathUtils.lerp(0.28, 1.45, hand.openness) : 1;
    uniforms.time.value = time;
    uniforms.center.value.x += (x - uniforms.center.value.x) * ease;
    uniforms.center.value.y += (y - uniforms.center.value.y) * ease;
    uniforms.spread.value += (spread - uniforms.spread.value) * ease;
    renderer.render(scene, camera);
  };
}
