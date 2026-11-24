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
  varying vec3 tint;
  varying float intensity;
  varying vec2 streak;

  const float TAU = 6.2831853;

  vec3 palette(float hue) {
    vec3 violet = vec3(0.56, 0.16, 1.0);
    vec3 blue = vec3(0.18, 0.43, 1.0);
    vec3 cyan = vec3(0.17, 0.92, 1.0);
    return mix(mix(violet, blue, smoothstep(0.0, 0.62, hue)),
               cyan, smoothstep(0.43, 1.0, hue));
  }

  void main() {
    float phase = seed.x * TAU;
    float twinkle = 0.68 + 0.32 * sin(time * (1.7 + seed.y * 5.0) + phase * 5.0);
    float large = pow(seed.w, 14.0);
    vec3 p;
    streak = vec2(0.0);

    if (seed.z < 0.07) {
      // Sparse, drifting points give the energy field a full-screen depth reference.
      p = vec3((seed.xy - 0.5) * viewSize * 1.12, -4.0);
      p.xy += 0.28 * vec2(sin(time * 0.46 + phase), cos(time * 0.43 + seed.y * TAU));
      tint = palette(seed.w);
      intensity = (0.12 + 0.32 * large) * twinkle;
      gl_PointSize = (1.6 + 3.1 * large) * resolution;
    } else {
      float radius;
      if (seed.z < 0.65) {
        // Three spiral arms wrap a tilted vortex with turbulent edges.
        float arm = floor(seed.y * 3.0) * TAU / 3.0;
        float scatter = fract(seed.y * 3.0) - 0.5;
        radius = mix(0.22, 4.8, pow(seed.x, 0.69));
        float angle = arm + radius * 1.18 + rotation * (1.25 - seed.x * 0.49);
        angle += scatter * (0.62 + radius * 0.33) + 0.14 * sin(time * 2.1 + phase * 3.0);
        p = vec3(cos(angle) * radius, sin(angle) * radius,
                 scatter * (0.6 + radius * 0.2) + sin(angle * 2.0 + time) * 0.33);
        p.yz = mat2(0.58, 0.815, -0.815, 0.58) * p.yz;
        float roll = -0.24 + 0.19 * sin(time * 0.65);
        p.xy = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * p.xy;
      } else {
        // A rotating volume surrounds the hot core and remains spherical when charged.
        float z = seed.y * 2.0 - 1.0;
        float ring = sqrt(max(0.0, 1.0 - z * z));
        float angle = phase + rotation * (1.05 + 0.48 * z);
        radius = mix(0.30, 2.4, pow(fract(seed.z * 19.13), 0.48));
        p = radius * vec3(ring * cos(angle), z, ring * sin(angle));
        p.y += sin(angle * 2.0 + time) * radius * 0.12;
      }

      p *= mix(1.0 + openness * 0.19, 0.25, charge);
      float depth = 16.0 / (16.0 - p.z);
      p.xy = p.xy * depth + center;
      if (burstPower > 0.0) {
        vec2 offset = p.xy - burstOrigin;
        float distance = length(offset);
        float front = (0.44 + 6.9 * (1.0 - exp(-burstAge * 3.4))) * burstPower;
        float impulse = exp(-abs(distance - front) * 1.05 - burstAge * 2.8);
        p.xy += offset / max(0.18, distance) * impulse * (0.7 + seed.w * 0.8);
      }
      tint = palette(clamp(0.51 + 0.43 * sin(phase - radius * 0.72 + rotation * 0.34), 0.0, 1.0));
      float heat = charge * (0.36 + 0.64 * (1.0 - smoothstep(0.0, 4.4, radius)));
      tint = mix(tint, mix(vec3(1.0, 0.61, 0.22), vec3(1.0, 0.97, 0.87), seed.w), heat);
      intensity = (0.13 + 0.44 * seed.w + large * 0.43) * twinkle * gain;
      intensity *= (0.84 + p.z * 0.07) * (1.0 + heat * 0.46);
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
      tint = mix(vec3(0.52, 0.20, 1.0), vec3(0.20, 0.88, 1.0), seed.w);
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
    float core = exp(-d * d * mix(13.0, 21.0, charge)) * (0.44 + 0.56 * charge);
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
