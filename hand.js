const VISION_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createHandLandmarker() {
  const { FilesetResolver, HandLandmarker } = await import(VISION_ROOT + '/vision_bundle.mjs');
  const files = await FilesetResolver.forVisionTasks(VISION_ROOT + '/wasm');
  return HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 1
  });
}

function bend(a, b, c) {
  const x = a.x - b.x, y = a.y - b.y, z = a.z - b.z;
  const u = c.x - b.x, v = c.y - b.y, w = c.z - b.z;
  const length = Math.hypot(x, y, z) * Math.hypot(u, v, w);
  return length ? (x * u + y * v + z * w) / length : 0;
}

export function readHand(result) {
  const landmarks = result.landmarks[0];
  if (!landmarks) return null;
  const joints = result.worldLandmarks?.[0] ?? landmarks;
  let extension = 0;
  // Use the four fingers so thumb position alone cannot change the gesture.
  for (const base of [5, 9, 13, 17]) {
    const angle = bend(joints[base], joints[base + 1], joints[base + 3]);
    extension += Math.max(0, Math.min(1, (-angle - 0.25) / 0.65));
  }
  return {
    x: 1 - (landmarks[0].x + landmarks[9].x) * 0.5,
    y: (landmarks[0].y + landmarks[9].y) * 0.5,
    openness: extension / 4
  };
}
