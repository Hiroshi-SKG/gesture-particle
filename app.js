import { createParticleField } from './particles.js?v=particle-palette-1';
import { createHandLandmarker, readHand } from './hand.js';

const art = document.querySelector('#art');
const button = document.querySelector('#camera');
const video = document.querySelector('#preview, #camera-feed');
const status = document.querySelector('#status');
const statusLabel = document.querySelector('#status-label');
const errorMessage = document.querySelector('#error');

let stream;
let detector;
let startupTimer;
let session = 0;
let cameraState = 'idle';
let hand = null;
let lastVideoTime = -1;
let lastDetection = -Infinity;
let render;
const detectionInterval = matchMedia('(pointer: coarse)').matches ? 80 : 55;

function setStatus(state, label) {
  status.dataset.state = state;
  statusLabel.textContent = label;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function setCameraState(state) {
  cameraState = state;
  button.lastElementChild.textContent = state === 'idle' ? 'カメラを開始' : 'カメラを停止';
}

function stopCamera() {
  session++;
  clearTimeout(startupTimer);
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  if (video) {
    video.pause();
    video.srcObject = null;
  }
  hand = null;
  lastVideoTime = -1;
  lastDetection = -Infinity;
  setCameraState('idle');
  setStatus('idle', '待機中');
}

function cameraError(error) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'カメラが許可されていません。ブラウザのサイト設定で許可してから再試行してください。';
    case 'NotFoundError':
      return 'カメラが見つかりません。利用できるカメラを接続してください。';
    case 'NotReadableError':
      return 'カメラを使用できません。他のアプリを閉じてから再試行してください。';
    default:
      return 'カメラを開始できませんでした。接続やブラウザの設定をご確認ください。';
  }
}

function setStartupDeadline(request, delay, message) {
  clearTimeout(startupTimer);
  startupTimer = setTimeout(() => {
    if (request !== session) return;
    stopCamera();
    showError(message);
  }, delay);
}

async function playCamera(request) {
  // Set the playback properties before attaching the stream, including on WebKit.
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  while (request === session && video.readyState < 2) {
    if (video.error) throw video.error;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function startCamera() {
  showError('');
  if (!video) {
    showError('カメラ画面を準備できませんでした。ページを再読み込みしてください。');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showError('カメラを利用できません。対応ブラウザで HTTPS または localhost から開いてください。');
    return;
  }

  const request = ++session;
  setCameraState('loading');
  setStatus('loading', 'カメラ準備中');
  let failure;
  try {
    setStartupDeadline(request, 30000, 'カメラの応答がありません。アクセス許可を確認し、もう一度開始してください。');
    const input = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 }
      },
      audio: false
    });
    if (request !== session) {
      input.getTracks().forEach(track => track.stop());
      return;
    }
    stream = input;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (request !== session) return;
        stopCamera();
        showError('カメラとの接続が切れました。もう一度開始してください。');
      }, { once: true });
    }

    failure = '映像を再生できませんでした。ブラウザでページを開き直し、もう一度開始してください。';
    setStartupDeadline(request, 8000, failure);
    await playCamera(request);
    if (request !== session) return;

    setStatus('loading', '認識モデル読み込み中');
    failure = '手の認識モデルを読み込めませんでした。ネット接続を確認して再試行してください。';
    setStartupDeadline(request, 30000, failure);
    const nextDetector = detector ?? await createHandLandmarker();
    if (request !== session) {
      if (nextDetector !== detector) nextDetector.close();
      return;
    }
    detector = nextDetector;
    clearTimeout(startupTimer);
    setCameraState('live');
    setStatus('live', '手を探しています');
  } catch (error) {
    if (request !== session) return;
    stopCamera();
    showError(failure ?? cameraError(error));
  }
}

function updateHand(now) {
  if (cameraState !== 'live' || video.readyState < 2 ||
      now - lastDetection < detectionInterval || video.currentTime === lastVideoTime) return;

  lastVideoTime = video.currentTime;
  lastDetection = now;
  try {
    const nextHand = readHand(detector.detectForVideo(video, now));
    if (Boolean(nextHand) !== Boolean(hand)) {
      setStatus('live', nextHand ? '手を検出中' : '手を探しています');
    }
    hand = nextHand;
  } catch {
    stopCamera();
    detector.close();
    detector = undefined;
    showError('手の認識を続けられませんでした。カメラをもう一度開始してください。');
  }
}

button.addEventListener('click', () => {
  if (cameraState === 'idle') void startCamera();
  else stopCamera();
});
window.addEventListener('pagehide', stopCamera);

let previous = performance.now();
let elapsed = 0;
function frame(now) {
  const delta = Math.min(Math.max((now - previous) / 1000, 0), 0.05);
  previous = now;
  elapsed += delta;
  updateHand(now);
  render(elapsed, delta, hand);
  requestAnimationFrame(frame);
}

try {
  render = await createParticleField(art);
  button.disabled = false;
  art.querySelector('canvas').addEventListener('webglcontextlost', () => {
    stopCamera();
    button.disabled = true;
    showError('描画を続けられませんでした。ページを再読み込みしてください。');
  });
  requestAnimationFrame(frame);
} catch {
  setStatus('idle', '描画できません');
  showError('粒子を描画できませんでした。ネット接続とブラウザの WebGL 2 対応をご確認ください。');
}
