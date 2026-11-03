/**
 * Phone PWA assets served by the local HTTPS backend.
 * MotusCap ProductionApp flow as reference — Lite-sized implementation.
 */

import { zhHans, zhHant } from '../lib/messages';

const LOCALE_MESSAGES_JS = `const LOCALE_MESSAGES = ${JSON.stringify({
  'zh-Hant': zhHant,
  'zh-Hans': zhHans,
})};`;

export const PWA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>KneeVidScan-Desktop · Pair phone</title>
  <link rel="stylesheet" href="/pwa/app.css" />
</head>
<body>
  <main class="page">
    <p class="brand" data-i18n="KneeVidScan-Desktop">KneeVidScan-Desktop</p>
    <h1 data-i18n="Pair this phone">Pair this phone</h1>
    <p id="status" class="status" data-i18n="Loading pairing details…">Loading pairing details…</p>
    <p class="label" data-i18n="Pairing code">Pairing code</p>
    <p id="code" class="code">—</p>
    <p id="pairing-id" class="meta"></p>
    <label id="camera-label" class="label" for="camera-select" data-i18n="Camera">Camera</label>
    <select id="camera-select">
      <option value="" data-i18n="Show cameras first">Show cameras first</option>
    </select>
    <p id="camera-hint" class="hint" hidden></p>
    <button id="btn-cameras" class="btn" type="button" data-i18n="Show cameras">Show cameras</button>
    <button id="btn-pair" class="btn primary" type="button" data-i18n="Complete pairing">Complete pairing</button>
    <a id="secure-link" class="btn" hidden data-i18n="Open secure camera page">Open secure camera page</a>
    <p id="secure-help" class="hint" hidden data-i18n="QR apps cannot show the certificate prompt. Open the secure page in Chrome or Safari, then continue past the warning.">QR apps cannot show the certificate prompt. Open the secure page in Chrome or Safari, then continue past the warning.</p>
    <p id="pair-err" class="err"></p>
    <video id="video" playsinline muted autoplay hidden></video>
    <canvas id="preview-canvas" hidden></canvas>
    <p id="cam-title" class="meta"></p>
    <p id="cam-meta" class="meta"></p>
    <p class="row"><span id="rec-pill" data-i18n="Idle">Idle</span> <span id="timer">00:00</span></p>
    <button id="btn-retry" class="btn primary" type="button" hidden data-i18n="Retry upload">Retry upload</button>
    <p class="hint" data-i18n="Keep this page open after pairing. The desktop starts and stops recording.">Keep this page open after pairing. The desktop starts and stops recording.</p>
  </main>
  <script src="/pwa/app.js"></script>
</body>
</html>
`;

export const PWA_CSS = `:root{color-scheme:light}
*{box-sizing:border-box}
[hidden]{display:none !important}
html,body{margin:0;background:#f4f7fb;color:#121826;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.page{max-width:480px;margin:0 auto;padding:20px 16px 32px;display:flex;flex-direction:column;gap:10px}
.brand{margin:0;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#2f6fe0}
h1{margin:0;font-size:28px;line-height:1.2}
.status{margin:0;font-size:16px;line-height:1.4}
.label{margin:8px 0 0;font-size:13px;font-weight:700;color:#44506a}
.code{margin:0;font-size:28px;font-weight:800;letter-spacing:.04em}
.meta{margin:0;font-size:13px;color:#44506a;word-break:break-all}
select,.btn{width:100%;font:inherit;font-size:16px;border-radius:12px;padding:12px 14px}
select{background:#fff;border:1px solid #c5d0e0;color:#121826}
.btn{border:1px solid #c5d0e0;background:#fff;font-weight:700}
a.btn{display:block;text-align:center;text-decoration:none;color:#121826;word-break:break-all}
.btn.primary{background:#2f6fe0;border-color:#2f6fe0;color:#fff}
.err{margin:0;color:#9f1239;font-size:14px;line-height:1.4;min-height:1.2em}
video{width:100%;max-height:42vh;background:#111;border-radius:12px}
.row{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums;font-weight:700}
.hint{margin:0;font-size:13px;color:#44506a;line-height:1.4}
`;

/**
 * Pure helpers inlined at the top of the phone script; tests run them in a VM.
 */
export const PWA_HELPERS_JS = `
  // Android Chrome reports video/mp4;codecs=avc1 but records an empty file.
  // Prefer WebM whenever the browser can record it. Safari cannot, so iPhone
  // still records H.264 MP4 and skips the desktop re-encode.
  const RECORDER_TYPES = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  function pickRecorderType(isSupported) {
    for (const type of RECORDER_TYPES) {
      try { if (isSupported(type)) return type; } catch (_) { /* unsupported */ }
    }
    return '';
  }
  function extensionFor(type) {
    return String(type || '').indexOf('mp4') >= 0 ? 'mp4' : 'webm';
  }
  // Empty MediaRecorder output is not a video. Report it instead of uploading.
  function emptyRecordingMessage(size, mime) {
    if (size > 0) return '';
    return 'Recorder produced no data (' + (mime || 'unknown') + ')';
  }
  // Desktop clock minus phone clock, taking the reply as stamped mid-trip.
  function clockSample(t0, t1, serverNow) {
    return { rtt: t1 - t0, offset: serverNow - (t0 + t1) / 2 };
  }
  const CLOCK_SAMPLES_KEPT = 10;
  function pushClockSample(samples, sample) {
    return samples.concat([sample]).slice(-CLOCK_SAMPLES_KEPT);
  }
  // The fastest round trip bounds the offset most tightly.
  function bestOffset(samples) {
    let best = null;
    for (const s of samples) if (!best || s.rtt < best.rtt) best = s;
    return best ? best.offset : 0;
  }
  const UPLOAD_RETRY_DELAYS_MS = [2000, 4000, 8000];
  // Fast previews only when the phone talks to the desktop over the LAN.
  function isLanHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (!h) return false;
    if (h === 'localhost' || h.endsWith('.local')) return true;
    const m = /^(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(h);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  const PREVIEW_PROFILES = {
    lan: {
      standing: { intervalMs: 50, longSide: 640, quality: 0.6 },
      capture: { intervalMs: 66, longSide: 480, quality: 0.6 },
      captureRecording: { intervalMs: 100, longSide: 360, quality: 0.5 },
      idle: { intervalMs: 400, longSide: 320, quality: 0.55 },
    },
    public: {
      standing: { intervalMs: 66, longSide: 640, quality: 0.6 },
      capture: { intervalMs: 200, longSide: 320, quality: 0.55 },
      captureRecording: { intervalMs: 250, longSide: 280, quality: 0.5 },
      idle: { intervalMs: 400, longSide: 320, quality: 0.55 },
    },
  };
  const PREVIEW_MIN_LONG_SIDE = {
    standing: 480,
    capture: 320,
    captureRecording: 240,
    idle: 320,
  };
  const PROBE_BODY_BYTES = 65536;
  function presetIdeals(id) {
    if (id === '720p') return { width: 1280, height: 720 };
    if (id === '480p') return { width: 854, height: 480 };
    return { width: 1920, height: 1080 };
  }
  function resolutionConstraints(maxRes, presetId) {
    if (maxRes) {
      return { width: { ideal: 3840 }, height: { ideal: 2160 } };
    }
    const ideals = presetIdeals(presetId || '1080p');
    return { width: { ideal: ideals.width }, height: { ideal: ideals.height } };
  }
  function previewProfile(mode, lan) {
    return Object.assign({}, PREVIEW_PROFILES[lan ? 'lan' : 'public'][mode]);
  }
  // The desktop preview toggle only covers Capture; Standing and Pair need frames.
  function previewSuppressed(mode, enabled) {
    return !enabled && (mode === 'capture' || mode === 'captureRecording');
  }
  function stepDownLongSide(longSide, floor) {
    return Math.max(floor, Math.round((longSide * 0.75) / 40) * 40);
  }
  // Safari may hand out new camera ids after a reload, so fall back to the label.
  function pickCamera(videos, savedId, savedLabel) {
    const list = videos || [];
    const byId = savedId && list.find((v) => v.deviceId === savedId);
    if (byId) return byId.deviceId;
    const byLabel = savedLabel && list.find((v) => v.label === savedLabel);
    return byLabel ? byLabel.deviceId : '';
  }
  function translateText(messages, locale, text, vars) {
    const table = messages && messages[locale];
    let out = table && Object.prototype.hasOwnProperty.call(table, text) ? table[text] : String(text == null ? '' : text);
    if (vars) {
      for (const key in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, key)) {
          out = out.split('{' + key + '}').join(String(vars[key]));
        }
      }
    }
    return out;
  }
  function retainLocale(prev, result) {
    if (!result || !result.ok || !result.ready) return prev;
    const locale = result.locale === 'zh-Hant' || result.locale === 'zh-Hans' ? result.locale : 'en';
    return { locale: locale, received: true };
  }
`;

export const PWA_JS = `(() => {
  ${LOCALE_MESSAGES_JS}
${PWA_HELPERS_JS}
  const nativeFetch = window.fetch.bind(window);
  // ngrok free tunnels answer with a warning page unless this header is sent.
  const fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('ngrok-skip-browser-warning', '1');
    return nativeFetch(input, Object.assign({}, init, { headers }));
  };
  const params = new URLSearchParams(location.search);
  const api = params.get('api') || location.origin;
  const pairingId = params.get('device_pairing_id');
  const pairingCode = params.get('device_pairing_code') || undefined;

  const el = {
    status: document.getElementById('status'),
    code: document.getElementById('code'),
    pairingIdLabel: document.getElementById('pairing-id'),
    cameraLabel: document.getElementById('camera-label'),
    cameraSelect: document.getElementById('camera-select'),
    cameraHint: document.getElementById('camera-hint'),
    btnCameras: document.getElementById('btn-cameras'),
    btnPair: document.getElementById('btn-pair'),
    secureLink: document.getElementById('secure-link'),
    secureHelp: document.getElementById('secure-help'),
    pairErr: document.getElementById('pair-err'),
    camTitle: document.getElementById('cam-title'),
    camMeta: document.getElementById('cam-meta'),
    video: document.getElementById('video'),
    canvas: document.getElementById('preview-canvas'),
    recPill: document.getElementById('rec-pill'),
    timer: document.getElementById('timer'),
    btnRetry: document.getElementById('btn-retry'),
  };

  let selectedDeviceId = localStorage.getItem('mcl_camera_id') || '';
  let selectedLabel = localStorage.getItem('mcl_camera_label') || '';
  // Resolves once a camera switch has opened the new stream (or restored the old one).
  let cameraSwitch = null;

  let deviceId = localStorage.getItem('mcl_device_id');
  let token = localStorage.getItem('mcl_token');
  let viewCode = localStorage.getItem('mcl_view') || '';
  let camIndex = Number(localStorage.getItem('mcl_cam_index') || '0');
  let mediaStream = null;
  let previewTimer = null;
  let pollTimer = null;
  let stillPollTimer = null;
  // Desktop Standing screen active: max-res stream + 20 fps preview.
  let standingMode = false;
  // Desktop Capture screen open: 15 fps previews, recorded stream untouched.
  let captureMode = false;
  let recordingPresetId = '1080p';
  // Preset whose constraints the live track has; null while standing (max res).
  let appliedPresetId = null;
  let recordingBitrate = 6000000;
  let previewEnabled = true;
  let probeInFlight = false;
  let lastProbeAt = 0;
  let probeRequestedLocal = false;
  // Preview uploads pause while a still or trial video is sent, so the
  // large POST is not reset (the desktop then shows "Failed · aborted").
  let stillBusy = false;
  let uploadBusy = false;
  // Trial signal received; the recorder is being set up on the open camera.
  let preparingTrial = false;
  // Bumped when a newer trial starts, so a stuck upload cannot block it.
  let uploadGen = 0;
  let uploadAbort = null;
  const previewLan = (() => {
    try { return isLanHost(new URL(api).hostname); } catch (_) { return false; }
  })();
  // Long side currently used per mode; lowered when the phone falls behind.
  const previewLongSide = {
    standing: previewProfile('standing', previewLan).longSide,
    capture: previewProfile('capture', previewLan).longSide,
    captureRecording: previewProfile('captureRecording', previewLan).longSide,
    idle: previewProfile('idle', previewLan).longSide,
  };
  // Cycles slower than 1.5× the interval in a row before stepping down.
  const PREVIEW_SLOW_CYCLES = 20;
  // JPEG keeps a 4K still at ~2–4 MB (PNG is 10–25 MB and slow to encode on phones).
  const STILL_JPEG_QUALITY = 0.95;
  // One trial recording: recorder, its chunks, and its timers.
  let session = null;
  // Trials this phone already recorded or skipped; never start them again.
  let lastTrialId = null;
  let clockSamples = [];
  // Last upload that gave up, kept for the Retry button.
  let failedUpload = null;
  let trialPollBusy = false;
  let localeState = { locale: 'en', received: false };
  let statusKey = '';
  let statusCls = '';
  let statusVars = null;
  let pillKey = 'Idle';
  let pillVars = null;
  let errorKey = '';
  let errorVars = null;
  let camerasFilled = false;
  let cameraList = [];
  let camHeader = '';

  function t(text, vars) {
    const locale = localeState.received ? localeState.locale : 'en';
    return translateText(LOCALE_MESSAGES, locale, text, vars);
  }

  function paintStatic() {
    const root = document.documentElement;
    if (root) {
      root.lang = localeState.locale === 'zh-Hant'
        ? 'zh-HK'
        : localeState.locale === 'zh-Hans'
          ? 'zh-CN'
          : 'en';
    }
    if (document.querySelectorAll) {
      const nodes = document.querySelectorAll('[data-i18n]');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.textContent = t(node.getAttribute('data-i18n'));
      }
    }
    try { document.title = t('KneeVidScan-Desktop · Pair phone'); } catch (_) { /* test document */ }
  }

  function setStatus(text, cls, vars) {
    statusKey = text;
    statusCls = cls || '';
    statusVars = vars || null;
    el.status.textContent = t(text, statusVars);
    el.status.className = 'status' + (statusCls ? ' ' + statusCls : '');
  }

  function setPill(text, vars) {
    pillKey = text;
    pillVars = vars || null;
    el.recPill.textContent = t(text, pillVars);
  }

  function showError(message, vars) {
    errorKey = message || '';
    errorVars = vars || null;
    el.pairErr.textContent = errorKey ? t(errorKey, errorVars) : '';
  }

  function paintCamHeader() {
    if (camHeader === 'paired') {
      const role = viewCode ? (' · ' + viewCode) : t(' · single camera');
      el.camTitle.textContent = t('Cam {n}', { n: camIndex + 1 }) + role;
      el.camMeta.textContent = t('Paired as {id}. Keep this page open.', {
        id: deviceId || t('this phone'),
      });
    } else if (camHeader === 'unpaired') {
      el.camTitle.textContent = t('Unpaired');
      el.camMeta.textContent = '';
    }
  }

  function paintPairingId() {
    el.pairingIdLabel.textContent = pairingId
      ? t('Pairing ID {id}', { id: pairingId })
      : t('Missing pairing id. Scan the QR on the desktop again.');
  }

  function paintLocale() {
    paintStatic();
    if (statusKey) setStatus(statusKey, statusCls, statusVars);
    if (pillKey) setPill(pillKey, pillVars);
    if (errorKey) showError(errorKey, errorVars);
    if (camerasFilled) fillCameraSelect(cameraList);
    refreshCameraLock();
    paintCamHeader();
    paintPairingId();
    if (el.secureLink && !el.secureLink.hidden) {
      el.secureLink.textContent = t('Open secure camera page');
    }
  }

  async function pollLocale() {
    try {
      const res = await fetch(api + '/v1/locale', { cache: 'no-store' });
      if (!res.ok) throw new Error('status');
      const body = await res.json();
      const next = retainLocale(localeState, {
        ok: true,
        ready: !!(body && body.ready),
        locale: body && body.locale,
      });
      const changed = next.locale !== localeState.locale || next.received !== localeState.received;
      localeState = next;
      if (changed && next.received) paintLocale();
    } catch (_) {
      localeState = retainLocale(localeState, { ok: false });
    }
  }

  async function apiFetch(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(api + path, Object.assign({}, opts, { headers }));
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      const err = new Error((body && body.error) || res.statusText || 'Request failed');
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  async function listCameras() {
    if (!navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((device) => device.kind === 'videoinput');
  }

  function fillCameraSelect(videos) {
    camerasFilled = true;
    cameraList = videos || [];
    const current = el.cameraSelect.value;
    el.cameraSelect.innerHTML = '';
    if (!cameraList.length) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = t('No camera found');
      el.cameraSelect.appendChild(empty);
      return;
    }
    cameraList.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || t('Camera {n}', { n: index + 1 });
      el.cameraSelect.appendChild(option);
    });
    if (current) el.cameraSelect.value = current;
  }

  function cameraOptionLabel(id) {
    const options = Array.from(el.cameraSelect.options || []);
    const option = options.find((o) => o.value === id);
    return (option && option.textContent) || '';
  }

  function rememberCamera(id, label) {
    selectedDeviceId = id || '';
    selectedLabel = label || '';
    localStorage.setItem('mcl_camera_id', selectedDeviceId);
    localStorage.setItem('mcl_camera_label', selectedLabel);
  }

  /** Camera the open stream actually uses; browsers may ignore an ideal constraint. */
  function currentCameraId() {
    const track = mediaStream && mediaStream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : null;
    return (settings && settings.deviceId) || selectedDeviceId;
  }

  async function showCameras() {
    showError('');
    if (!window.isSecureContext) {
      showError('Camera needs HTTPS. Open the desktop QR and accept the certificate warning.');
      setStatus('Camera blocked');
      return;
    }
    setStatus('Allow the camera prompt, then pick a camera.');
    el.btnCameras.disabled = true;
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      probe.getTracks().forEach((track) => track.stop());
      const videos = await listCameras();
      fillCameraSelect(videos);
      if (!videos.length) {
        setStatus('No camera found on this phone.');
        return;
      }
      selectedDeviceId = pickCamera(videos, selectedDeviceId, selectedLabel) || videos[0].deviceId;
      el.cameraSelect.value = selectedDeviceId;
      setStatus('Camera list ready. Complete pairing when the right camera is selected.');
    } catch (e) {
      showError(e.message || String(e));
      setStatus('Camera permission was blocked.');
    } finally {
      el.btnCameras.disabled = false;
    }
  }

  async function completePairing() {
    showError('');
    if (!pairingId) {
      showError('Missing device_pairing_id. Scan the desktop QR again.');
      return;
    }
    if (!el.cameraSelect.value) {
      showError('Show cameras and select one before completing pairing.');
      return;
    }
    const selected = el.cameraSelect.options[el.cameraSelect.selectedIndex];
    const deviceName = (selected && selected.textContent) || 'Phone';
    el.btnPair.disabled = true;
    setStatus('Pairing…');
    try {
      const body = await apiFetch('/v1/device-pairings/' + encodeURIComponent(pairingId) + '/complete', {
        method: 'POST',
        body: JSON.stringify({
          code: pairingCode,
          device_name: deviceName,
        }),
      });
      deviceId = body.device_id;
      token = body.device_pairing_token;
      viewCode = body.view_code || '';
      camIndex = body.cam_index ?? 0;
      localStorage.setItem('mcl_device_id', deviceId);
      localStorage.setItem('mcl_token', token);
      localStorage.setItem('mcl_view', viewCode);
      localStorage.setItem('mcl_cam_index', String(camIndex));
      rememberCamera(selectedDeviceId, deviceName);
      await enterCamera();
    } catch (e) {
      showError(e.message || String(e));
      setStatus('Pairing failed');
      el.btnPair.disabled = false;
    }
  }

  async function ensureCamera() {
    if (cameraSwitch) await cameraSwitch;
    return openCamera();
  }

  function openStream(id) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: Object.assign(
        id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } },
        resolutionConstraints(standingMode, recordingPresetId),
      ),
    });
  }

  function stopCamera() {
    if (!mediaStream) return;
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  async function openCamera() {
    if (mediaStream) return mediaStream;
    if (!window.isSecureContext) {
      throw new Error('Camera needs HTTPS. Open this page via the desktop QR (HTTPS).');
    }
    let stream;
    try {
      stream = await openStream(selectedDeviceId);
    } catch (e) {
      const stale = e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError');
      if (!selectedDeviceId || !stale) throw e;
      stream = await openStream('');
      const match = pickCamera(await listCameras().catch(() => []), '', selectedLabel);
      if (match) {
        stream.getTracks().forEach((track) => track.stop());
        stream = await openStream(match);
      }
      rememberCamera(match, match ? selectedLabel : '');
    }
    mediaStream = stream;
    appliedPresetId = standingMode ? null : recordingPresetId;
    el.video.hidden = false;
    el.video.srcObject = mediaStream;
    await el.video.play();
    return mediaStream;
  }

  function cameraLocked() {
    return Boolean(session) || preparingTrial || uploadBusy || stillBusy || Boolean(cameraSwitch);
  }

  function refreshCameraLock() {
    if (!token || el.cameraSelect.hidden) return;
    const locked = cameraLocked();
    el.cameraSelect.disabled = locked;
    el.cameraHint.textContent = t(locked
      ? 'Camera switching unlocks when recording and uploads finish.'
      : 'You can switch cameras between trials.');
  }

  async function showPairedCameras() {
    let videos = [];
    try { videos = await listCameras(); } catch (_) { /* keep the open camera */ }
    const show = videos.length > 1;
    el.cameraLabel.hidden = !show;
    el.cameraSelect.hidden = !show;
    el.cameraHint.hidden = !show;
    if (!show) return;
    fillCameraSelect(videos);
    el.cameraSelect.value = currentCameraId();
    refreshCameraLock();
  }

  function reportCameraName(name) {
    if (!token || !deviceId || !name) return;
    void apiFetch('/v1/devices/' + encodeURIComponent(deviceId) + '/camera', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }

  async function switchCamera(id) {
    if (!token || !id || id === currentCameraId()) return;
    if (cameraLocked()) {
      el.cameraSelect.value = currentCameraId();
      showError('Wait until recording and uploads finish to switch cameras.');
      return;
    }
    const previous = { id: selectedDeviceId, label: selectedLabel };
    const label = cameraOptionLabel(id);
    let finish;
    cameraSwitch = new Promise((resolve) => { finish = resolve; });
    refreshCameraLock();
    showError('');
    setStatus('Switching camera…');
    try {
      // Most phones open only one camera at a time.
      stopCamera();
      selectedDeviceId = id;
      try {
        await openCamera();
        rememberCamera(id, label);
        reportCameraName(label);
        setStatus('Paired. Camera is live.');
      } catch (e) {
        stopCamera();
        selectedDeviceId = previous.id;
        showError('Could not open that camera: {detail}', { detail: (e && e.message) || String(e) });
        try {
          await openCamera();
          setStatus('Paired. Camera is live.');
        } catch (e2) {
          setStatus('Camera error');
        }
      }
    } finally {
      cameraSwitch = null;
      finish();
      el.cameraSelect.value = currentCameraId();
      refreshCameraLock();
    }
  }

  async function applyRecordingPresetIfIdle() {
    if (session || standingMode || appliedPresetId === recordingPresetId) return;
    const track = mediaStream && mediaStream.getVideoTracks()[0];
    if (!track) return;
    const target = recordingPresetId;
    try {
      await track.applyConstraints(resolutionConstraints(false, target));
    } catch (_) { /* keep the current resolution */ }
    // Marked even on failure so an unsupported size is not retried every poll.
    appliedPresetId = target;
  }

  async function runLinkProbe() {
    if (probeInFlight || !token || !deviceId) return;
    // Stays pending: a probe would compete with the recording or upload.
    if (session || preparingTrial || uploadBusy || stillBusy) return;
    const now = Date.now();
    if (now - lastProbeAt < 5000) return;
    probeInFlight = true;
    probeRequestedLocal = false;
    try {
      const track = mediaStream && mediaStream.getVideoTracks()[0];
      const s = (track && track.getSettings()) || {};
      const body = new Uint8Array(PROBE_BODY_BYTES);
      const t0 = Date.now();
      await fetch(api + '/v1/devices/' + encodeURIComponent(deviceId) + '/link-probe-bytes', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/octet-stream',
        },
        body,
      });
      const uploadBytesPerSec =
        body.length / Math.max(0.001, (Date.now() - t0) / 1000);
      await fetch(api + '/v1/devices/' + encodeURIComponent(deviceId) + '/link-probe', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          width: s.width || 0,
          height: s.height || 0,
          frameRate: s.frameRate || 0,
          uploadBytesPerSec,
        }),
      });
      lastProbeAt = Date.now();
    } catch (_) {
      /* keep polling; desktop may retry probeRequested */
    } finally {
      probeInFlight = false;
    }
  }

  async function setStandingMode(active) {
    if (active === standingMode) return;
    // Never resize the stream mid-recording.
    if (active && session) return;
    standingMode = active;
    const track = mediaStream && mediaStream.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints(resolutionConstraints(active, recordingPresetId));
    } catch (_) { /* keep the current resolution */ }
    appliedPresetId = active ? null : recordingPresetId;
  }

  function previewMode() {
    if (standingMode) return 'standing';
    if (captureMode && session) return 'captureRecording';
    if (captureMode) return 'capture';
    return 'idle';
  }

  function startPreviewLoop() {
    if (previewTimer) return;
    const ctx = el.canvas.getContext('2d');
    let slowCycles = 0;
    let lastMode = previewMode();
    const tick = async () => {
      const started = Date.now();
      const mode = previewMode();
      if (mode !== lastMode) { slowCycles = 0; lastMode = mode; }
      const profile = previewProfile(mode, previewLan);
      try {
        const vw = el.video.videoWidth;
        const vh = el.video.videoHeight;
        if (mediaStream && token && vw && vh && !stillBusy && !uploadBusy && !previewSuppressed(mode, previewEnabled)) {
          // Keep the true aspect so portrait frames are not squashed.
          const scale = Math.min(1, previewLongSide[mode] / Math.max(vw, vh));
          const w = Math.round(vw * scale);
          const h = Math.round(vh * scale);
          if (el.canvas.width !== w) el.canvas.width = w;
          if (el.canvas.height !== h) el.canvas.height = h;
          ctx.drawImage(el.video, 0, 0, w, h);
          const blob = await new Promise((resolve) =>
            el.canvas.toBlob(resolve, 'image/jpeg', profile.quality),
          );
          if (blob) {
            await fetch(api + '/v1/devices/' + encodeURIComponent(deviceId) + '/preview', {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'image/jpeg',
              },
              body: blob,
            });
          }
          const spent = Date.now() - started;
          slowCycles = spent > profile.intervalMs * 1.5 ? slowCycles + 1 : 0;
          if (slowCycles >= PREVIEW_SLOW_CYCLES) {
            previewLongSide[mode] = stepDownLongSide(previewLongSide[mode], PREVIEW_MIN_LONG_SIDE[mode]);
            slowCycles = 0;
          }
        }
      } catch (_) { /* keep trying */ }
      if (!token) { previewTimer = null; return; }
      previewTimer = setTimeout(tick, Math.max(0, profile.intervalMs - (Date.now() - started)));
    };
    previewTimer = setTimeout(tick, 0);
  }

  function formatTimer(ms) {
    const s = Math.floor(ms / 1000);
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return m + ':' + ss;
  }

  function serverToLocal(ms) {
    return ms - bestOffset(clockSamples);
  }

  function clearSessionTimers(rec) {
    if (rec.startTimer) clearTimeout(rec.startTimer);
    if (rec.stopTimer) clearTimeout(rec.stopTimer);
    if (rec.countdownTimer) clearInterval(rec.countdownTimer);
    if (rec.tickTimer) clearInterval(rec.tickTimer);
    rec.startTimer = rec.stopTimer = rec.countdownTimer = rec.tickTimer = null;
  }

  function reportUploadError(tid, message) {
    if (!token || !deviceId) return;
    void apiFetch('/v1/devices/' + encodeURIComponent(deviceId) + '/trials/' + encodeURIComponent(tid) + '/upload-error', {
      method: 'POST',
      body: JSON.stringify({ error: message }),
    }).catch(() => {});
  }

  function recordingFailed(tid, message, vars) {
    setPill('Not recording');
    setStatus('Recording failed', 'err');
    showError(message, vars);
    reportUploadError(tid, vars ? translateText(null, 'en', message, vars) : message);
  }

  function supersedeUpload() {
    uploadGen += 1;
    uploadBusy = false;
    refreshCameraLock();
    if (uploadAbort) {
      uploadAbort.abort();
      uploadAbort = null;
    }
  }

  async function scheduleRecording(signal) {
    preparingTrial = true;
    refreshCameraLock();
    try {
      await prepareRecording(signal);
    } finally {
      preparingTrial = false;
      refreshCameraLock();
    }
  }

  async function prepareRecording(signal) {
    // Drop a failed or still-open upload so this take can record and upload.
    supersedeUpload();
    lastTrialId = signal.trialId;
    if (!window.MediaRecorder) {
      recordingFailed(signal.trialId, 'This browser cannot record video.');
      return;
    }
    try {
      await ensureCamera();
      await setStandingMode(false);
      // A preset change that arrived mid-upload or while standing lands here.
      await applyRecordingPresetIfIdle();
    } catch (e) {
      recordingFailed(signal.trialId, (e && e.message) || String(e));
      return;
    }
    const mime = pickRecorderType((type) => MediaRecorder.isTypeSupported(type));
    let recorder;
    try {
      recorder = new MediaRecorder(
        mediaStream,
        mime ? { mimeType: mime, videoBitsPerSecond: recordingBitrate } : { videoBitsPerSecond: recordingBitrate },
      );
    } catch (e) {
      recordingFailed(signal.trialId, 'Recorder unavailable: {detail}', { detail: (e && e.message) || String(e) });
      return;
    }
    const rec = {
      trialId: signal.trialId,
      signal,
      recorder,
      mime,
      chunks: [],
      started: false,
      discard: false,
      startTimer: null,
      stopTimer: null,
      countdownTimer: null,
      tickTimer: null,
    };
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    recorder.onerror = (ev) => {
      showError('Recorder error: {detail}', { detail: (ev && ev.error && ev.error.message) || 'unknown' });
    };
    recorder.onstop = () => {
      if (!rec.discard) void uploadRecording(rec);
    };
    session = rec;
    refreshCameraLock();
    failedUpload = null;
    el.btnRetry.hidden = true;
    showError('');
    setStatus('Get ready');
    rec.countdownTimer = setInterval(() => {
      const left = serverToLocal(signal.startAtMs) - Date.now();
      setPill('Starting in {seconds}', { seconds: Math.max(1, Math.ceil(left / 1000)) });
    }, 100);
    armStartTimer(rec);
  }

  // Re-aimed on every poll during the countdown as the clock estimate improves.
  function armStartTimer(rec) {
    if (rec.started || session !== rec) return;
    if (rec.startTimer) clearTimeout(rec.startTimer);
    const delay = Math.max(0, serverToLocal(rec.signal.startAtMs) - Date.now());
    rec.startTimer = setTimeout(() => beginRecording(rec), delay);
  }

  function beginRecording(rec) {
    if (session !== rec || rec.started) return;
    clearSessionTimers(rec);
    try {
      rec.recorder.start(250);
    } catch (e) {
      session = null;
      refreshCameraLock();
      recordingFailed(rec.trialId, 'Recorder could not start: {detail}', { detail: (e && e.message) || String(e) });
      return;
    }
    rec.started = true;
    const startedAt = Date.now();
    setPill('REC');
    setStatus('Recording');
    el.timer.textContent = formatTimer(0);
    rec.tickTimer = setInterval(() => {
      el.timer.textContent = formatTimer(Date.now() - startedAt);
    }, 250);
    // Stop on our own if the desktop never says so.
    const endAt = serverToLocal(rec.signal.startAtMs + rec.signal.maxDurationMs);
    rec.stopTimer = setTimeout(() => stopRecording(rec), Math.max(0, endAt - Date.now()));
  }

  function stopRecording(rec) {
    if (session !== rec) return;
    session = null;
    refreshCameraLock();
    clearSessionTimers(rec);
    if (!rec.started) {
      rec.discard = true;
      setPill('Idle');
      setStatus('Paired. Camera is live.');
      return;
    }
    setPill('Uploading…');
    setStatus('Uploading video');
    if (rec.recorder.state !== 'inactive') rec.recorder.stop();
  }

  function cancelRecording(rec) {
    if (session !== rec) return;
    rec.discard = true;
    stopRecording(rec);
    setPill('Idle');
    setStatus('Trial cancelled. Camera is live.');
  }

  async function uploadRecording(rec) {
    const type = rec.recorder.mimeType || rec.mime || 'video/webm';
    const blob = new Blob(rec.chunks, { type });
    rec.chunks = [];
    const empty = emptyRecordingMessage(blob.size, type);
    if (empty) {
      setPill('Upload failed');
      setStatus('Upload failed', 'err');
      showError('Recorder produced no data ({mime})', { mime: type || 'unknown' });
      reportUploadError(rec.trialId, empty);
      return;
    }
    const suffix = viewCode ? '_' + viewCode : '';
    await sendUpload({
      trialId: rec.trialId,
      blob,
      filename: 'trial_' + rec.trialId + suffix + '.' + extensionFor(type),
    });
  }

  function uploadDropped(message) {
    return /abort|reset|network|timed out|timeout|connection dropped/i.test(message || '');
  }

  async function sendUpload(job) {
    if (uploadAbort) uploadAbort.abort();
    const gen = ++uploadGen;
    const controller = new AbortController();
    uploadAbort = controller;
    uploadBusy = true;
    refreshCameraLock();
    failedUpload = null;
    el.btnRetry.hidden = true;
    showError('');
    setPill('Uploading…');
    setStatus('Uploading video');
    const url = api + '/v1/devices/' + encodeURIComponent(deviceId) + '/trials/' + encodeURIComponent(job.trialId) + '/upload?filename=' + encodeURIComponent(job.filename);
    let lastErr = 'Upload failed';
    try {
      for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt++) {
        if (gen !== uploadGen) return;
        if (attempt > 0) {
          const wait = UPLOAD_RETRY_DELAYS_MS[attempt - 1];
          setStatus('Upload failed, retrying in {seconds} s', '', { seconds: wait / 1000 });
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (gen !== uploadGen) return;
          setStatus('Uploading video (try {n})', '', { n: attempt + 1 });
        }
        if (!token) return;
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/octet-stream',
              'X-Filename': job.filename,
            },
            body: job.blob,
            signal: controller.signal,
          });
          if (res.ok) {
            if (gen !== uploadGen) return;
            if (!session) {
              setPill('Uploaded');
              setStatus('Uploaded. Camera is live.');
            }
            return;
          }
          const body = await res.json().catch(() => null);
          lastErr = (body && body.error) || ('Desktop answered ' + res.status);
          // A rejected file will fail again. A dropped connection will not.
          if (res.status >= 400 && res.status < 500 && !uploadDropped(lastErr)) break;
        } catch (e) {
          if (gen !== uploadGen || controller.signal.aborted) return;
          lastErr = (e && e.message) || String(e);
        }
      }
      if (gen !== uploadGen) return;
      failedUpload = job;
      if (!session) {
        setPill('Upload failed');
        setStatus('Upload failed', 'err');
      }
      const answered = /^Desktop answered (\\d+)$/.exec(lastErr);
      if (answered) showError('Desktop answered {status}', { status: answered[1] });
      else showError(lastErr);
      el.btnRetry.hidden = false;
      reportUploadError(job.trialId, lastErr);
    } finally {
      if (gen === uploadGen) {
        uploadBusy = false;
        if (uploadAbort === controller) uploadAbort = null;
        refreshCameraLock();
      }
    }
  }

  async function grabStandingStill() {
    await ensureCamera();
    const vw = el.video.videoWidth;
    const vh = el.video.videoHeight;
    if (!vw || !vh) throw new Error('Camera has no frame yet');
    const stillCanvas = document.createElement('canvas');
    stillCanvas.width = vw;
    stillCanvas.height = vh;
    const sctx = stillCanvas.getContext('2d');
    if (!sctx) throw new Error('Phone canvas unavailable');
    // Clean still at the stream's native resolution — same framing as the
    // preview, no guide / skeleton overlay. Grab first, encode after.
    sctx.drawImage(el.video, 0, 0, vw, vh);
    const blob = await new Promise((resolve) =>
      stillCanvas.toBlob(resolve, 'image/jpeg', STILL_JPEG_QUALITY),
    );
    stillCanvas.width = 0;
    stillCanvas.height = 0;
    if (!blob) throw new Error('Phone could not encode the photo');
    return blob;
  }

  async function uploadStandingStill() {
    // A claimed request must still be answered, so wait out a camera switch.
    if (cameraSwitch) await cameraSwitch;
    if (!mediaStream || !token || !deviceId) return;
    stillBusy = true;
    refreshCameraLock();
    try {
      const blob = await grabStandingStill();
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(api + '/v1/devices/' + encodeURIComponent(deviceId) + '/still', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'image/jpeg',
            },
            body: blob,
          });
          if (res.ok) return;
          lastErr = new Error('Desktop rejected the photo (' + res.status + ')');
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('Photo upload failed');
    } catch (e) {
      await apiFetch('/v1/devices/' + encodeURIComponent(deviceId) + '/still-error', {
        method: 'POST',
        body: JSON.stringify({ error: (e && e.message) || String(e) }),
      }).catch(() => {});
    } finally {
      stillBusy = false;
      refreshCameraLock();
    }
  }

  // Desktop re-paired this slot with another phone: our token is revoked.
  function handleUnpaired() {
    if (!token) return;
    token = null;
    deviceId = null;
    ['mcl_device_id', 'mcl_token', 'mcl_view', 'mcl_cam_index'].forEach((k) => localStorage.removeItem(k));
    [previewTimer, stillPollTimer].forEach((t) => { if (t) clearTimeout(t); });
    previewTimer = null;
    stillPollTimer = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    stopCamera();
    el.cameraLabel.hidden = true;
    el.cameraSelect.hidden = true;
    el.cameraHint.hidden = true;
    el.video.srcObject = null;
    el.video.hidden = true;
    camHeader = 'unpaired';
    paintCamHeader();
    if (session) cancelRecording(session);
    supersedeUpload();
    failedUpload = null;
    el.btnRetry.hidden = true;
    setPill('Idle');
    setStatus('This phone was unpaired — scan a new QR to pair again.', 'err');
  }

  async function pollStillRequest() {
    if (!token || !deviceId) return;
    let pending = false;
    try {
      const body = await apiFetch('/v1/devices/' + encodeURIComponent(deviceId) + '/still-request');
      await setStandingMode(Boolean(body && body.standing));
      captureMode = Boolean(body && body.livePose);
      if (body && typeof body.recordingPreset === 'string') {
        recordingPresetId = body.recordingPreset;
      }
      await applyRecordingPresetIfIdle();
      if (body && typeof body.videoBitsPerSecond === 'number' && body.videoBitsPerSecond > 0) {
        recordingBitrate = body.videoBitsPerSecond;
      }
      if (body && typeof body.previewEnabled === 'boolean') {
        previewEnabled = body.previewEnabled;
      }
      if (body && body.probeRequested) probeRequestedLocal = true;
      if (probeRequestedLocal) void runLinkProbe();
      pending = Boolean(body && body.pending);
    } catch (e) {
      if (e && e.status === 401) handleUnpaired();
    }
    if (pending) await uploadStandingStill();
  }

  function startStillPoll() {
    if (stillPollTimer) return;
    const tick = async () => {
      await pollStillRequest();
      if (!token) return;
      // Poll faster on Standing so the shutter follows the countdown closely.
      stillPollTimer = setTimeout(tick, standingMode ? 150 : 400);
    };
    stillPollTimer = setTimeout(tick, 0);
  }

  async function pollTrial() {
    if (trialPollBusy) return;
    trialPollBusy = true;
    try {
      const t0 = Date.now();
      const body = await apiFetch('/v1/trials/active');
      const t1 = Date.now();
      if (body && typeof body.server_now === 'number') {
        clockSamples = pushClockSample(clockSamples, clockSample(t0, t1, body.server_now));
      }
      const t = body && body.trial;
      const rec = session;
      if (rec && (!t || t.trial_id !== rec.trialId)) {
        // A newer trial began, or ours is long over: finish ours first.
        stopRecording(rec);
      } else if (rec) {
        if (t.phase === 'done' || t.phase === 'stopping') stopRecording(rec);
        else if (t.phase === 'cancelled') cancelRecording(rec);
        else armStartTimer(rec);
        return;
      }
      if (t && t.phase === 'recording' && t.start_signal && t.trial_id !== lastTrialId) {
        const sig = t.start_signal;
        if (serverToLocal(sig.startAtMs + sig.maxDurationMs) > Date.now()) {
          await scheduleRecording(sig);
        } else {
          lastTrialId = t.trial_id;
        }
      }
    } catch (_) {
      /* desktop unreachable: keep recording, the stop timer still applies */
    } finally {
      trialPollBusy = false;
    }
  }

  async function enterCamera() {
    camHeader = 'paired';
    paintCamHeader();
    el.btnCameras.hidden = true;
    el.btnPair.hidden = true;
    el.cameraLabel.hidden = true;
    el.cameraSelect.hidden = true;
    el.cameraHint.hidden = true;
    setStatus('Paired. Camera is live.');
    try {
      await ensureCamera();
      await showPairedCameras();
      startPreviewLoop();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        pollTrial();
      }, 400);
      startStillPoll();
    } catch (e) {
      setStatus('Camera error');
      showError(e.message || String(e));
    }
  }

  el.code.textContent = pairingCode || '—';
  paintPairingId();
  el.btnCameras.addEventListener('click', () => void showCameras());
  el.btnPair.addEventListener('click', () => void completePairing());
  el.btnRetry.addEventListener('click', () => {
    if (failedUpload) void sendUpload(failedUpload);
  });
  el.cameraSelect.addEventListener('change', () => {
    if (token) void switchCamera(el.cameraSelect.value);
    else selectedDeviceId = el.cameraSelect.value;
  });

  const secureOrigin = params.get('secure');
  if (!window.isSecureContext && secureOrigin && pairingId) {
    const secure = secureOrigin.endsWith('/') ? secureOrigin.slice(0, -1) : secureOrigin;
    el.secureLink.textContent = t('Open secure camera page');
    const next = new URL(secure + '/pwa/');
    next.searchParams.set('api', secure);
    next.searchParams.set('device_pairing_id', pairingId);
    if (pairingCode) next.searchParams.set('device_pairing_code', pairingCode);
    el.secureLink.href = next.toString();
    el.secureLink.hidden = false;
    el.secureHelp.hidden = false;
  }

  if (!pairingId) {
    setStatus('This page has no pairing id.');
    el.btnPair.disabled = true;
    el.btnCameras.disabled = true;
  } else {
    setStatus('Show cameras, select one, then complete pairing.');
  }

  void apiFetch('/v1/health').then(() => {
    if (pairingId && statusKey.indexOf('Pairing') === -1 && statusKey.indexOf('Camera') === -1 && statusKey.indexOf('Paired') === -1) {
      setStatus('Desktop connected. Show cameras, select one, then complete pairing.');
    }
  }).catch(() => {
    showError('Cannot reach the desktop at {api}. Stay on the same Wi-Fi and accept the certificate warning.', { api: api });
    setStatus('Desktop server not reachable.');
  });

  if (deviceId && token && !pairingId) {
    void enterCamera();
  }

  void pollLocale();
  setInterval(() => { void pollLocale(); }, 500);
})();
`;
