const particlePalette = /* glsl */ `
  vec3 palette(float hue, float selector) {
    // Stable particle seeds mix both families throughout every stream.
    float warm = step(0.70, selector);
    vec3 low = mix(vec3(0.15, 0.34, 1.0), vec3(1.0, 0.34, 0.10), warm);
    vec3 high = mix(vec3(0.20, 0.91, 1.0), vec3(1.0, 0.78, 0.33), warm);
    return mix(low, high, hue);
  }
`;

export const pointFragment = /* glsl */ `
  varying vec3 tint;
  varying float intensity;
  varying vec2 streak;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float reach = length(streak);
    vec2 direction = reach > 0.0 ? streak / reach : vec2(1.0, 0.0);
    p -= direction * clamp(dot(p, direction), -reach, reach * 0.14);
    float r = dot(p, p);
    float glow = exp(-7.0 * r) * (1.0 - smoothstep(0.48, 0.98, r));
    float core = exp(-35.0 * r);
    gl_FragColor = vec4(mix(tint, vec3(1.0, 0.97, 0.91), core * 0.65),
                        (glow * 0.77 + core * 0.75) * intensity);
  }
`;

export const fieldVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float time, rotation, charge, openness, resolution, gain;
  uniform float burstAge, burstPower;
  uniform vec2 center, viewSize, burstOrigin;
  uniform vec4 guides[8];
  varying vec3 tint;
  varying float intensity;
  varying vec2 streak;

  const float TAU = 6.2831853;

  ${particlePalette}

  vec2 eddyOffset(float loop, float phase, float seed) {
    return (0.35 + 0.9 * seed) * vec2(sin(loop * 3.0 + phase), cos(loop * 2.0 + phase));
  }

  void main() {
    float phase = seed.x * TAU;
    float paletteSeed = fract(seed.x + seed.w);
    float twinkle = 0.68 + 0.32 * sin(time * (1.7 + seed.y * 5.0) + phase * 5.0);
    float large = pow(seed.w, 14.0);
    vec3 p;
    streak = vec2(0.0);

    if (seed.z < 0.07) {
      // Sparse, drifting points give the energy field a full-screen depth reference.
      p = vec3((seed.xy - 0.5) * viewSize * 1.12, -4.0);
      p.xy += 0.28 * vec2(sin(time * 0.46 + phase), cos(time * 0.43 + seed.y * TAU));
      tint = palette(seed.w, paletteSeed);
      intensity = (0.12 + 0.32 * large) * twinkle;
      gl_PointSize = (1.6 + 3.1 * large) * resolution;
    } else {
      float lane = floor(seed.y * 5.0);
      float fiber = fract(seed.y * 5.0) - 0.5;
      // Each lane mixes fast followers and particles that linger on older paths.
      float lag = min(6.999, 7.0 * clamp(seed.x * 0.75 + lane * 0.050, 0.0, 1.0));
      int index = int(lag);
      vec4 flow = mix(guides[index], guides[index + 1], fract(lag));
      float speed = length(flow.zw);
      vec2 direction = flow.zw / max(speed, 0.08);
      vec2 normal = vec2(-direction.y, direction.x);
      float shear = min(speed * 0.10, 1.5);

      // Particles circulate through curved lanes. Lane phase and width leave moving gaps.
      float loop = phase + time * (0.39 + 0.105 * lane);
      float lanePhase = lane * 2.39996 + time * 0.19;
      float reach = 1.0 + openness * 0.31;
      float sweep = sin(loop);
      float ribbon = cos(loop);
      float flare = (0.55 + 0.45 * sin(loop + 0.66 + lanePhase));
      float width = 0.13 + 0.73 * flare * flare;
      float transverse = fiber * width;
      vec3 openFlow = vec3(
        (2.92 + lane * 0.21) * sweep + 0.51 * sin(2.0 * loop + lanePhase),
        (0.74 + lane * 0.10) * sin(2.0 * loop + lanePhase) + 0.79 * ribbon,
        1.55 * cos(loop + lanePhase) + transverse
      );
      openFlow.y += transverse * 1.7;
      openFlow.x += 0.44 * cos(lanePhase + loop * 2.0);
      float roll = lanePhase + 0.27 * sin(time * 0.62 + lanePhase);
      openFlow.xy = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * openFlow.xy;
      if (seed.z > 0.74) {
        // Loose eddies exchange particles with the denser branches.
        openFlow.xyz *= 0.48 + 0.65 * seed.w;
        openFlow.yz += eddyOffset(loop, lanePhase, seed.z);
      }
      vec2 turbulence = vec2(
        sin(openFlow.y * 1.8 + loop * 2.0 + time * 1.4),
        cos(openFlow.x * 1.7 - loop * 2.0 + time * 1.2)
      );
      openFlow.xy = openFlow.xy * reach + turbulence * (0.21 + 0.13 * shear);
      openFlow.xy += shear * (direction * sweep * 0.72 + normal * ribbon * 0.44);

      // Different response curves curl each streamline into the dense sphere in succession.
      float squeeze = pow(charge, mix(0.67, 2.2, seed.z));
      float z = seed.y * 2.0 - 1.0;
      float ring = sqrt(max(0.0, 1.0 - z * z));
      float turn = phase + rotation * (0.65 + 0.52 * seed.z) + squeeze * (3.8 + 6.5 * seed.x);
      float radius = 0.18 + 0.84 * sqrt(fract(seed.z * 31.73));
      vec3 core = radius * vec3(ring * cos(turn), z, ring * sin(turn));
      p = mix(openFlow, core, squeeze);
      float depth = 16.0 / (16.0 - p.z);
      p.xy = p.xy * depth + mix(flow.xy, center, squeeze * squeeze);

      if (burstPower > 0.0) {
        // A subset is advected out from the release point before rejoining its lane.
        float escaped = smoothstep(0.34, 0.83, seed.z);
        float spread = (1.0 - exp(-burstAge * (3.4 + seed.y * 3.0))) * (2.0 + seed.w * 6.2);
        vec2 release = vec2(cos(phase + lane), sin(phase + lane));
        vec2 expelled = burstOrigin + release * spread * burstPower;
        expelled += vec2(-release.y, release.x) * (0.7 * sin(burstAge * 2.8 + lanePhase));
        float rejoin = smoothstep(0.0, 0.11, burstAge) * (1.0 - smoothstep(0.23, 1.2, burstAge));
        p.xy = mix(p.xy, expelled, escaped * rejoin);
        p.z += (seed.y - 0.5) * rejoin * escaped * 3.0;
      }

      tint = palette(0.51 + 0.43 * sin(loop + lanePhase - transverse), paletteSeed);
      float heat = squeeze * (0.57 + 0.43 * (1.0 - radius));
      tint = mix(tint, mix(vec3(1.0, 0.61, 0.22), vec3(1.0, 0.97, 0.87), seed.w), heat);
      intensity = (0.13 + 0.44 * seed.w + large * 0.43) * twinkle * gain;
      intensity *= (0.84 + p.z * 0.07) * (1.0 + heat * 0.46);
      intensity *= mix(0.67 + 0.46 * flare, 1.0, squeeze);
      gl_PointSize = (1.8 + 3.6 * seed.w * seed.w + 5.5 * large) * depth * resolution;
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const accentVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float time, resolution, burstAge, burstPower;
  uniform vec2 burstOrigin;
  uniform vec4 trail[18];
  varying vec3 tint;
  varying float intensity;
  varying vec2 streak;

  ${particlePalette}

  void main() {
    float angle = seed.x * 6.2831853;
    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 p;
    float size;
    if (seed.z < 0.5) {
      vec4 samplePoint = trail[min(17, int(seed.y * 18.0))];
      float age = samplePoint.z;
      float speed = samplePoint.w;
      p = samplePoint.xy + direction * seed.w * (0.28 + age * 0.62);
      p += vec2(sin(time * 3.0 + angle), cos(time * 3.0 + angle)) * age * 0.18;
      tint = palette(seed.w, fract(seed.x + seed.y));
      intensity = speed * exp(-age * 5.5) * (0.22 + 0.61 * seed.w);
      size = (3.0 + 7.0 * pow(seed.w, 4.0)) * (1.0 - 0.5 * min(age, 1.0));
      streak = vec2(0.0);
    } else {
      float age = max(0.0, burstAge - seed.y * 0.13);
      float life = 0.28 + seed.w * 0.83;
      float distance = mix(1.8, 10.0, seed.w) * (1.0 - exp(-age * 4.4)) * burstPower;
      p = burstOrigin + direction * (0.14 + distance) + vec2(0.0, -age * age * 0.8);
      tint = mix(vec3(0.32, 0.68, 1.0), vec3(1.0, 0.65, 0.25), step(0.72, seed.y));
      intensity = step(seed.y * 0.13, burstAge) * (1.0 - smoothstep(0.04, life, age));
      intensity *= (0.55 + seed.w * 0.58) * burstPower;
      size = (4.0 + 10.0 * seed.w) * (1.0 - smoothstep(0.17, 0.9, age) * 0.68);
      streak = vec2(direction.x, -direction.y) * (0.48 - min(age, 1.0) * 0.25);
    }
    gl_PointSize = max(1.0, size * resolution);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 2.0, 1.0);
  }
`;

export const glowVertex = /* glsl */ `
  varying vec2 screen;
  void main() {
    screen = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const glowFragment = /* glsl */ `
  uniform vec2 viewSize, center, burstOrigin;
  uniform float time, charge, burstAge, burstPower;
  varying vec2 screen;

  float band(float distance, float radius, float width) {
    float d = (distance - radius) / width;
    return exp(-d * d);
  }

  void main() {
    vec2 p = screen * viewSize * 0.5;
    float d = length(p - center);
    float pulse = 0.91 + 0.09 * sin(time * 3.3);
    float haze = exp(-d * d * 0.20) * (0.17 + 0.10 * charge) * pulse;
    float corona = exp(-d * d * mix(2.0, 4.8, charge)) * (0.27 + 0.49 * charge);
    float core = exp(-d * d * mix(13.0, 21.0, charge)) * (0.30 + 0.70 * charge);
    float shell = band(d, 0.68, 0.09) * charge * 0.34;
    float r = length(p - burstOrigin);
    float waveRadius = (0.44 + 6.9 * (1.0 - exp(-burstAge * 3.4))) * burstPower;
    float waveFade = burstPower * (1.0 - smoothstep(0.04, 0.78, burstAge));
    float wave = (band(r, waveRadius, 0.045 + burstAge * 0.12) * 0.79
      + band(r, waveRadius, 0.23 + burstAge * 0.21) * 0.27
      + band(r, waveRadius * 0.74, 0.07 + burstAge * 0.12) * 0.22) * waveFade;
    float flash = exp(-r * r * 1.7 - burstAge * 17.0) * burstPower;
    vec3 light = vec3(0.36, 0.10, 1.0) * haze
      + mix(vec3(0.22, 0.61, 1.0), vec3(1.0, 0.52, 0.16), charge) * (corona + shell)
      + vec3(0.94, 0.95, 1.0) * (core + flash)
      + vec3(0.48, 0.83, 1.0) * wave;
    float alpha = max(max(light.r, light.g), light.b);
    gl_FragColor = vec4(light / max(alpha, 0.001), min(alpha, 1.0));
  }
`;
