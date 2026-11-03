# Preview Frame Rate and Image Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Posture preview at 20 fps and motion preview at 15 fps per camera for two cameras, on the same Wi-Fi as the desktop, without changing the recorded video or weakening the posture gate.

**Architecture:** The phone keeps one preview POST in flight and paces it per mode. A new mode table sets interval, long side and JPEG quality per mode, and steps down the long side when the phone cannot keep up. Phones paired through a public URL (ngrok) keep the old slow rates. On the desktop, Capture always long-polls previews (pose on or off), and pose detection is throttled separately from the picture so the picture rate does not depend on MediaPipe speed. The posture hold timer tolerates one short miss.

**Tech Stack:** Phone PWA script in `src/backend/pwaAssets.ts` (plain JS string, helpers tested in a VM), Node backend `src/backend/server.ts` / `store.ts`, React renderer, MediaPipe Tasks Vision in IMAGE mode, Vitest.

## Global Constraints

- Posture preview target: 20 fps (50 ms interval), long side 640 px, JPEG quality 0.6.
- Motion preview target: 15 fps (66 ms interval) per camera, long side 480 px, JPEG quality 0.6, with pose on or off, while the Capture screen is open.
- Idle preview (any other screen): unchanged, 400 ms, 320 px, quality 0.55.
- Public URL (non-LAN api host): posture 66 ms at 640 px; motion 200 ms at 320 px; idle unchanged.
- Recorded video is untouched: camera default frame rate, `videoBitsPerSecond: 6000000`, 1920×1080 ideal.
- Standing still is untouched: full-resolution JPEG at quality 0.95, separate from the preview.
- Previews stay paused while a still or trial video uploads (`stillBusy`, `uploadBusy`).
- Pose detection rate: posture ≤ 10 Hz; Capture ≤ 15 Hz per camera, lower when detection is slow.
- The posture gate still needs 500 ms of good frames; a miss shorter than 150 ms does not reset it.

## Current behaviour this replaces

| Mode | Interval | Long side | Quality | Desktop fetch |
|---|---|---|---|---|
| Standing (posture) | 66 ms | 960 px | 0.65 | long-poll |
| Capture, pose on | 100 ms | 320 px | 0.55 | long-poll |
| Capture, pose off | 400 ms | 320 px | 0.55 | timer every 500 ms |
| Idle | 400 ms | 320 px | 0.55 | timer |

## File structure

- Modify `src/backend/pwaAssets.ts`: mode table helpers in `PWA_HELPERS_JS` (`previewProfile`, `isLanHost`, `stepDownLongSide`); preview loop uses them; rename `livePoseMode` to `captureMode`.
- Modify `src/backend/pwaAssets.test.ts`: VM tests for the new helpers.
- Modify `src/backend/server.test.ts`: replace the `LIVE_POSE_PREVIEW_INTERVAL_MS = 100` string assertion.
- Modify `src/screens/Capture.tsx`: send the capture heartbeat whenever Capture is open, not only when pose is on.
- Modify `src/components/CamFeed.tsx`: long-poll when `live` is set; throttle detection; show measured fps.
- Create `src/lib/framePacing.ts` and `src/lib/framePacing.test.ts`: `createFpsMeter`, `detectGapMs`.
- Modify `src/lib/standingGate.ts` and `src/lib/standingGate.test.ts`: hold timer grace.
- Modify `src/screens/Subject.tsx`: throttle posture detection to 10 Hz, use the grace on countdown abort, show measured fps.

The backend endpoint `/live-pose-mode` and the `livePose` flag in `still-request` stay as they are, so a phone running the old script still works with the new desktop.

---

### Task 1: Phone preview profiles and LAN detection

**Files:**
- Modify: `src/backend/pwaAssets.ts` (`PWA_HELPERS_JS`, around line 71–98)
- Test: `src/backend/pwaAssets.test.ts`

**Interfaces:**
- Produces (inside `PWA_HELPERS_JS`):
  - `isLanHost(hostname: string): boolean`
  - `previewProfile(mode: 'standing' | 'capture' | 'idle', lan: boolean): { intervalMs: number, longSide: number, quality: number }`
  - `stepDownLongSide(longSide: number, floor: number): number`
  - `PREVIEW_MIN_LONG_SIDE = { standing: 480, capture: 320, idle: 320 }`

- [ ] **Step 1: Write the failing test**

Add to the `helpers` VM export list and type in `src/backend/pwaAssets.test.ts`:

```ts
const helpers = vm.runInNewContext(
  `${PWA_HELPERS_JS}; ({ pickRecorderType, extensionFor, clockSample, pushClockSample, bestOffset, UPLOAD_RETRY_DELAYS_MS, isLanHost, previewProfile, stepDownLongSide, PREVIEW_MIN_LONG_SIDE })`,
) as {
  // existing fields …
  isLanHost: (h: string) => boolean;
  previewProfile: (
    mode: 'standing' | 'capture' | 'idle',
    lan: boolean,
  ) => { intervalMs: number; longSide: number; quality: number };
  stepDownLongSide: (longSide: number, floor: number) => number;
  PREVIEW_MIN_LONG_SIDE: Record<'standing' | 'capture' | 'idle', number>;
};
```

Then:

```ts
describe('preview profiles', () => {
  it('treats private and local addresses as LAN, tunnels as public', () => {
    for (const h of ['192.168.0.8', '10.1.2.3', '172.20.0.5', 'localhost', '127.0.0.1', 'my-mac.local']) {
      expect(helpers.isLanHost(h)).toBe(true);
    }
    for (const h of ['motuscap-lite.ngrok-free.app', '8.8.8.8', '172.32.0.1', '']) {
      expect(helpers.isLanHost(h)).toBe(false);
    }
  });

  it('runs posture at 20 fps and motion at 15 fps on the LAN', () => {
    expect(helpers.previewProfile('standing', true)).toEqual({
      intervalMs: 50,
      longSide: 640,
      quality: 0.6,
    });
    expect(helpers.previewProfile('capture', true)).toEqual({
      intervalMs: 66,
      longSide: 480,
      quality: 0.6,
    });
    expect(helpers.previewProfile('idle', true)).toEqual({
      intervalMs: 400,
      longSide: 320,
      quality: 0.55,
    });
  });

  it('keeps slower previews through a public URL', () => {
    expect(helpers.previewProfile('standing', false).intervalMs).toBe(66);
    expect(helpers.previewProfile('capture', false)).toEqual({
      intervalMs: 200,
      longSide: 320,
      quality: 0.55,
    });
  });

  it('steps the long side down by a quarter, never below the floor', () => {
    expect(helpers.stepDownLongSide(640, 480)).toBe(480);
    expect(helpers.stepDownLongSide(480, 480)).toBe(480);
    expect(helpers.stepDownLongSide(480, 320)).toBe(360);
    expect(helpers.stepDownLongSide(360, 320)).toBe(320);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/backend/pwaAssets.test.ts`
Expected: FAIL, `isLanHost is not defined`.

- [ ] **Step 3: Write minimal implementation**

Append inside `PWA_HELPERS_JS`, after `UPLOAD_RETRY_DELAYS_MS`:

```js
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
      idle: { intervalMs: 400, longSide: 320, quality: 0.55 },
    },
    public: {
      standing: { intervalMs: 66, longSide: 640, quality: 0.6 },
      capture: { intervalMs: 200, longSide: 320, quality: 0.55 },
      idle: { intervalMs: 400, longSide: 320, quality: 0.55 },
    },
  };
  const PREVIEW_MIN_LONG_SIDE = { standing: 480, capture: 320, idle: 320 };
  function previewProfile(mode, lan) {
    return Object.assign({}, PREVIEW_PROFILES[lan ? 'lan' : 'public'][mode]);
  }
  function stepDownLongSide(longSide, floor) {
    return Math.max(floor, Math.round((longSide * 0.75) / 40) * 40);
  }
```

The regex backslashes are doubled because `PWA_HELPERS_JS` is a template string. Check `stepDownLongSide(480, 320)`: 480 × 0.75 = 360, rounded to a multiple of 40 is 360. `stepDownLongSide(360, 320)`: 270 → 280 → floor 320. Matches the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/backend/pwaAssets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/pwaAssets.ts src/backend/pwaAssets.test.ts
git commit -m "feat(phone): preview profiles per mode with LAN detection"
```

---

### Task 2: Phone preview loop uses the profiles and adapts

**Files:**
- Modify: `src/backend/pwaAssets.ts:143-157` (state and constants), `:310-351` (`startPreviewLoop`), `:680` (`pollStillRequest`)
- Modify: `src/backend/server.test.ts:268`
- Test: `src/backend/pwaAssets.test.ts`

**Interfaces:**
- Consumes: `isLanHost`, `previewProfile`, `stepDownLongSide`, `PREVIEW_MIN_LONG_SIDE` from Task 1.
- Produces: phone sends previews at the Task 1 rates; `captureMode` replaces `livePoseMode` and is set from the existing `body.livePose` flag.

- [ ] **Step 1: Write the failing test**

In `src/backend/pwaAssets.test.ts`, extend the wiring test:

```ts
  it('paces previews from the mode profile and steps down when slow', () => {
    expect(PWA_JS).toContain('previewProfile(');
    expect(PWA_JS).toContain('isLanHost(new URL(api).hostname)');
    expect(PWA_JS).toContain('stepDownLongSide(');
    expect(PWA_JS).not.toContain('LIVE_POSE_PREVIEW_INTERVAL_MS');
    expect(PWA_JS).toContain('captureMode = Boolean(body && body.livePose)');
  });
```

In `src/backend/server.test.ts`, replace

```ts
    expect(PWA_JS).toContain('LIVE_POSE_PREVIEW_INTERVAL_MS = 100');
```

with

```ts
    expect(PWA_JS).toContain("previewProfile('capture'");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/backend/pwaAssets.test.ts src/backend/server.test.ts -t "paces previews|live pose heartbeat"`
Expected: FAIL on the new string assertions.

- [ ] **Step 3: Write minimal implementation**

Replace the state block around lines 143–157:

```js
  // Desktop Standing screen active: max-res stream + 20 fps preview.
  let standingMode = false;
  // Desktop Capture screen open: 15 fps previews, recorded stream untouched.
  let captureMode = false;
  // Preview uploads pause while a still or trial video is sent, so the
  // large POST is not reset (the desktop then shows "Failed · aborted").
  let stillBusy = false;
  let uploadBusy = false;
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
    idle: previewProfile('idle', previewLan).longSide,
  };
  // Cycles slower than 1.5× the interval in a row before stepping down.
  const PREVIEW_SLOW_CYCLES = 20;
```

Delete `STANDING_PREVIEW_INTERVAL_MS`, `LIVE_POSE_PREVIEW_INTERVAL_MS` and `IDLE_PREVIEW_INTERVAL_MS`.

Replace `startPreviewLoop`:

```js
  function previewMode() {
    return standingMode ? 'standing' : captureMode ? 'capture' : 'idle';
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
        if (mediaStream && token && vw && vh && !stillBusy && !uploadBusy) {
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
```

In `pollStillRequest`, replace `livePoseMode = Boolean(body && body.livePose);` with `captureMode = Boolean(body && body.livePose);`.

The step-down never goes back up within one page load, so a phone that struggled once stays smaller. Reloading the phone page resets it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/backend/pwaAssets.test.ts src/backend/server.test.ts`
Expected: PASS, including the existing phone VM test (`a phone 5 s behind counts down …`).

- [ ] **Step 5: Commit**

```bash
git add src/backend/pwaAssets.ts src/backend/pwaAssets.test.ts src/backend/server.test.ts
git commit -m "feat(phone): 20 fps posture and 15 fps capture previews with step-down"
```

---

### Task 3: Frame pacing helpers

**Files:**
- Create: `src/lib/framePacing.ts`
- Test: `src/lib/framePacing.test.ts`

**Interfaces:**
- Produces:
  - `createFpsMeter(windowMs?: number): { tick(now: number): void; fps(now: number): number }`
  - `detectGapMs(targetGapMs: number, lastDetectMs: number, sharedBy: number): number`
  - `POSTURE_DETECT_GAP_MS = 100`, `CAPTURE_DETECT_GAP_MS = 66`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_DETECT_GAP_MS,
  POSTURE_DETECT_GAP_MS,
  createFpsMeter,
  detectGapMs,
} from './framePacing';

describe('fps meter', () => {
  it('counts frames in the last second', () => {
    const m = createFpsMeter(1000);
    for (let t = 0; t < 1000; t += 50) m.tick(t);
    expect(m.fps(1000)).toBe(20);
    expect(m.fps(2500)).toBe(0);
  });
});

describe('detection gap', () => {
  it('keeps the target when detection is fast', () => {
    expect(detectGapMs(CAPTURE_DETECT_GAP_MS, 10, 2)).toBe(66);
    expect(detectGapMs(POSTURE_DETECT_GAP_MS, 40, 1)).toBe(100);
  });

  it('spaces detections out when they are slow or shared', () => {
    expect(detectGapMs(CAPTURE_DETECT_GAP_MS, 35, 2)).toBe(105);
    expect(detectGapMs(POSTURE_DETECT_GAP_MS, 90, 1)).toBe(135);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/framePacing.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Desktop-side pacing for live previews: measured fps for the tile label,
 * and how often to run MediaPipe so the picture is never held up by it.
 */

/** Posture gate: full model, one camera. */
export const POSTURE_DETECT_GAP_MS = 100;
/** Capture overlay: lite model, per camera. */
export const CAPTURE_DETECT_GAP_MS = 66;

export function createFpsMeter(windowMs = 1000) {
  const stamps: number[] = [];
  const drop = (now: number) => {
    while (stamps.length && stamps[0] < now - windowMs) stamps.shift();
  };
  return {
    tick(now: number) {
      stamps.push(now);
      drop(now);
    },
    fps(now: number) {
      drop(now);
      return Math.round((stamps.length * 1000) / windowMs);
    },
  };
}

/**
 * Minimum time between detections on one feed. `sharedBy` feeds use the
 * same main-thread model, so each must leave room for the others.
 */
export function detectGapMs(
  targetGapMs: number,
  lastDetectMs: number,
  sharedBy: number,
): number {
  return Math.max(
    targetGapMs,
    Math.round(lastDetectMs * Math.max(1, sharedBy) * 1.5),
  );
}
```

Check: `detectGapMs(66, 35, 2)` = max(66, 105) = 105. `detectGapMs(100, 90, 1)` = max(100, 135) = 135. The meter test ticks at 0, 50, …, 950 (20 ticks); at `now = 1000` only stamps before 0 are dropped, so `fps(1000)` is 20, and at 2500 all are gone.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/framePacing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/framePacing.ts src/lib/framePacing.test.ts
git commit -m "feat: fps meter and detection pacing helpers"
```

---

### Task 4: Capture keeps fast previews with pose off, and throttles detection

**Files:**
- Modify: `src/screens/Capture.tsx:69-84` (heartbeat effect), `:313-320` (`CamGrid` props)
- Modify: `src/components/CamFeed.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `createFpsMeter`, `detectGapMs`, `CAPTURE_DETECT_GAP_MS` from Task 3.
- Produces: `CamFeed` / `CamGrid` prop `live?: boolean` (long-poll every frame); tile shows `data-fps` and a `cam-fps-<index>` label.

- [ ] **Step 1: Write the failing test, and update the live pose test**

The mock client already has `setLivePoseMode` (`src/App.test.tsx:213`). Add:

```ts
  it('Capture asks phones for fast previews even with pose off', async () => {
    const spy = vi.spyOn(mockClient, 'setLivePoseMode');
    await goToCapture();
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(devices[0].device_id, true),
    );
    expect(screen.getByTestId('cam-grid')).toHaveAttribute('data-show-pose', '0');
    expect(screen.getByTestId('cam-grid')).toHaveAttribute('data-live', '1');
    spy.mockRestore();
  });
```

Update the existing test `live 2D pose runs the real model on phone frames while the toggle is on` (`src/App.test.tsx:938-1007`), which assumes two things this task changes:

1. Two `fireEvent.load(img)` calls in a row each run detection. Detection is now paced, so step the clock between loads. At the start of the `try` block add:

```ts
      let clock = 1000;
      const nowSpy = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => clock);
```

and before the second `fireEvent.load(img)` (the one after `detect.mockReturnValue(null)`) add `clock += 200;`. Restore with `nowSpy.mockRestore();` in `finally`.

2. Turning the toggle off sends `setLivePoseMode(deviceId, false)`. The heartbeat now runs for the whole Capture screen, so replace

```ts
      await waitFor(() =>
        expect(setLive).toHaveBeenCalledWith(deviceId, false),
      );
```

with a check that leaving Capture turns it off:

```ts
      expect(setLive).not.toHaveBeenCalledWith(deviceId, false);
      fireEvent.click(screen.getByTestId('capture-back'));
      await waitFor(() =>
        expect(setLive).toHaveBeenCalledWith(deviceId, false),
      );
```

`capture-back` leaves without a confirm when not recording (`busy={recording}`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/App.test.tsx -t "fast previews even with pose off"`
Expected: FAIL, heartbeat not sent while pose is off.

- [ ] **Step 3: Write minimal implementation**

In `src/screens/Capture.tsx`, change the heartbeat effect so it no longer depends on `poseOn`:

```tsx
/** Phones keep 15 fps previews while this heartbeat is under the 6 s expiry. */
const CAPTURE_PREVIEW_HEARTBEAT_MS = 2000;
```

```tsx
  const deviceIds = devices.map((d) => d.deviceId).join(',');
  useEffect(() => {
    if (!deviceIds) return;
    const ids = deviceIds.split(',');
    const beat = (active: boolean) => {
      for (const id of ids) {
        void backendClient.setLivePoseMode(id, active).catch(() => {});
      }
    };
    beat(true);
    const timer = window.setInterval(
      () => beat(true),
      CAPTURE_PREVIEW_HEARTBEAT_MS,
    );
    return () => {
      window.clearInterval(timer);
      beat(false);
    };
  }, [deviceIds]);
```

Pass `live` to the grid:

```tsx
          <CamGrid
            camCount={Math.max(camCount, 1)}
            devices={devices}
            recording={recording && countdown == null}
            showPose={poseOn}
            live
            liveTag
            fitFrame
          />
```

In `src/components/CamFeed.tsx`:

1. Add `live?: boolean` to `Props` and to `CamGrid`'s props; pass it through; add `data-live={live ? '1' : '0'}` on the grid div.
2. Change the polling effect condition from `if (showPose) {` to `if (live || showPose) {`, and its dependency list to `[device?.deviceId, showPose, live]`. Update the comment above it to: `// Live (Capture): long-poll each new phone frame. Otherwise light polling.`
3. Throttle detection and meter frames. Add near the other refs:

```tsx
  const fpsMeter = useRef(createFpsMeter());
  const [fps, setFps] = useState(0);
  const lastDetectAt = useRef(0);
  const lastDetectMs = useRef(0);
```

Replace the detection part of `onFrame` (from `const lm = landmarkerRef.current;` to the end of the function):

```tsx
    const now = performance.now();
    fpsMeter.current.tick(now);
    const measured = fpsMeter.current.fps(now);
    setFps((prev) => (prev === measured ? prev : measured));

    const lm = landmarkerRef.current;
    const canvas = canvasRef.current;
    if (!showPose || !lm || !canvas) return;
    // The picture updates every frame; the skeleton keeps the last result
    // until the next detection slot.
    const gap = detectGapMs(CAPTURE_DETECT_GAP_MS, lastDetectMs.current, camCount);
    if (now - lastDetectAt.current < gap) return;
    lastDetectAt.current = now;
    let landmarks = null;
    try {
      landmarks = lm.detect(img);
    } catch {
      landmarks = null;
    }
    lastDetectMs.current = performance.now() - now;
    const feed = canvas.parentElement;
    const w = feed?.clientWidth || 320;
    const h = feed?.clientHeight || 240;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (landmarks) {
      if (ctx) drawLandmarks(ctx, landmarks, w, h, '#2F6FE0');
      setPoseStatus('live');
    } else {
      ctx?.clearRect(0, 0, w, h);
      setPoseStatus('no-person');
    }
```

4. Show the measured rate in the tile, next to the label:

```tsx
      {live && previewUrl ? (
        <span className="cam-fps" data-testid={`cam-fps-${index}`} data-fps={fps}>
          {fps} fps
        </span>
      ) : null}
```

Add to `src/styles/app.css` near `.cam-label`:

```css
.cam-fps {
  position: absolute;
  right: 8px;
  bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: rgba(21, 25, 34, 0.6);
  padding: 2px 6px;
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
}
```

Import at the top of `CamFeed.tsx`:

```tsx
import {
  CAPTURE_DETECT_GAP_MS,
  createFpsMeter,
  detectGapMs,
} from '../lib/framePacing';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/App.test.tsx`
Expected: PASS, including the existing Capture and pose toggle tests.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Capture.tsx src/components/CamFeed.tsx src/styles/app.css src/App.test.tsx
git commit -m "feat(capture): fast previews with pose on or off, paced pose detection"
```

---

### Task 5: Posture gate tolerates one short miss and detects at 10 Hz

**Files:**
- Modify: `src/lib/standingGate.ts:64-84`
- Test: `src/lib/standingGate.test.ts`
- Modify: `src/screens/Subject.tsx:119`, `:343-383` (`onFrame`)

**Interfaces:**
- Consumes: `createFpsMeter`, `detectGapMs`, `POSTURE_DETECT_GAP_MS` from Task 3.
- Produces: `createHoldTimer(holdMs?, graceMs?)`; `HoldTimer.missedFor(now: number): number`; `GATE_MISS_GRACE_MS = 150`.

- [ ] **Step 1: Write the failing test**

Keep the existing hold test (it uses `graceMs` default 0 only if you pass it; update it to pass `0` explicitly):

```ts
    const hold = createHoldTimer(500, 0);
```

Add:

```ts
  it('ignores a miss shorter than the grace, resets on a longer one', () => {
    const hold = createHoldTimer(500, 150);
    expect(hold.update(true, 0)).toBe(false);
    expect(hold.update(false, 200)).toBe(false);
    expect(hold.update(true, 300)).toBe(false);
    expect(hold.update(true, 500)).toBe(true);
    expect(hold.update(false, 600)).toBe(false);
    expect(hold.missedFor(700)).toBe(100);
    expect(hold.update(false, 800)).toBe(false);
    expect(hold.update(true, 900)).toBe(false);
    expect(hold.update(true, 1400)).toBe(true);
  });
```

Trace: ok since 0; miss at 200 starts a miss window; ok at 300 (miss lasted 100 ms < 150) keeps `since = 0`; at 500, 500 − 0 ≥ 500 → true. Miss at 600, still missing at 800 (200 ms ≥ 150) resets `since`; ok at 900 restarts; 1400 − 900 = 500 → true.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/standingGate.test.ts`
Expected: FAIL, `missedFor is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
/** A miss shorter than this does not reset the hold or abort the countdown. */
export const GATE_MISS_GRACE_MS = 150;

export type HoldTimer = {
  /** Feed the latest gate result; true once it has stayed ok for `holdMs`. */
  update: (ok: boolean, now: number) => boolean;
  /** How long the gate has been failing, 0 while ok. */
  missedFor: (now: number) => number;
  reset: () => void;
};

export function createHoldTimer(
  holdMs = GATE_HOLD_MS,
  graceMs = GATE_MISS_GRACE_MS,
): HoldTimer {
  let since: number | null = null;
  let missSince: number | null = null;
  return {
    update(ok, now) {
      if (!ok) {
        if (missSince == null) missSince = now;
        if (now - missSince >= graceMs) since = null;
        return false;
      }
      if (missSince != null && now - missSince >= graceMs) since = null;
      missSince = null;
      if (since == null) since = now;
      return now - since >= holdMs;
    },
    missedFor(now) {
      return missSince == null ? 0 : now - missSince;
    },
    reset() {
      since = null;
      missSince = null;
    },
  };
}
```

With `graceMs = 0`, the first miss already resets `since`, which keeps the original test's behaviour.

In `src/screens/Subject.tsx`:

1. Add refs next to `holdRef`:

```tsx
  const fpsMeter = useRef(createFpsMeter());
  const [fps, setFps] = useState(0);
  const lastDetectAt = useRef(0);
  const lastDetectMs = useRef(0);
```

2. In `onFrame`, after `setFrame(...)`, meter every frame and skip detection between slots:

```tsx
    const now = performance.now();
    fpsMeter.current.tick(now);
    const measured = fpsMeter.current.fps(now);
    setFps((prev) => (prev === measured ? prev : measured));

    const lm = landmarkerRef.current;
    const ph = phaseRef.current;
    if (!lm || (ph !== 'live' && ph !== 'count')) return;
    const step = POSTURE_STEPS[stepRef.current];
    if (!step) return;
    if (now - lastDetectAt.current < detectGapMs(POSTURE_DETECT_GAP_MS, lastDetectMs.current, 1)) {
      return;
    }
    lastDetectAt.current = now;

    let points: LandmarkPoint[] | null = null;
    try {
      points = lm.detect(img);
    } catch {
      points = null;
    }
    lastDetectMs.current = performance.now() - now;
```

3. Replace the countdown abort so it uses the grace:

```tsx
    const q = evaluateStandingLandmarks(step.side, points, guideRect(w, h));
    setQuality(q);
    const t = performance.now();
    const held = holdRef.current.update(q.ok, t);
    if (ph === 'live' && held) {
      startCountdown();
    } else if (
      ph === 'count' &&
      !q.ok &&
      holdRef.current.missedFor(t) >= GATE_MISS_GRACE_MS
    ) {
      // Lost a landmark mid-countdown for longer than one blip — back to red.
      backToLive();
    }
```

4. Show the measured rate on the posture stage, using the same `cam-fps` class, with `data-testid="standing-fps"`, only while `previewUrl && showLive`.

Import `GATE_MISS_GRACE_MS` from `../lib/standingGate` and the pacing helpers from `../lib/framePacing`.

Because detection runs at most every 100 ms, a single bad detection now lasts about 100 ms and stays under the 150 ms grace. Two bad detections in a row (about 200 ms) still reset the hold or abort the countdown.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/standingGate.test.ts src/App.test.tsx`
Expected: PASS, including the existing standing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/standingGate.ts src/lib/standingGate.test.ts src/screens/Subject.tsx src/styles/app.css
git commit -m "feat(standing): 10 Hz gate detection with a 150 ms miss grace"
```

---

### Task 6: Full check and on-device measurement

**Files:** none changed unless a target is missed.

- [ ] **Step 1: Run the full suite, typecheck and lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass. The backend tests need access to network interfaces; run them outside the sandbox if `uv_interface_addresses` fails.

- [ ] **Step 2: Measure posture on a real phone**

Restart the desktop app. Reload the phone page on the same Wi-Fi as the desktop (QR "Local network"). Open Subject → Standing. Read the `standing-fps` label for 30 s.
Expected: 18–20 fps steady. The gate still needs 0.5 s of green before the countdown, and briefly turning a heel away (under a quarter second) does not cancel the countdown.

If it reads 12–15 fps, the phone stepped down or is still too slow: check the phone's JPEG size in DevTools (expect about 25–45 KB per preview at 640 px).

- [ ] **Step 3: Measure motion with two cameras**

On Capture with two phones, pose off, record 60 s. Read both `cam-fps` labels.
Expected: 14–15 fps each while recording. Repeat with pose on. Expected: picture 14–15 fps; skeleton moves at about 15 Hz on GPU, about 9–10 Hz on CPU.

- [ ] **Step 4: Confirm the recordings did not suffer**

After Stop, wait for both uploads to finish, then:

Run: `ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=avg_frame_rate,nb_read_frames -of default=nw=1 <saved video>`
Expected: `avg_frame_rate` near 30/1 (the camera default) and `nb_read_frames` about 30 × duration. Both uploads finish without "Failed · aborted".

- [ ] **Step 5: Confirm the public-URL fallback**

Pair one phone via the ngrok QR, open Capture.
Expected: about 5 fps on that tile, and Standing about 15 fps; uploads still succeed.

- [ ] **Step 6: Commit any tuning**

If a measured rate misses the target, adjust only `PREVIEW_PROFILES` in `src/backend/pwaAssets.ts` (for example capture long side 480 → 400) and the matching test in `src/backend/pwaAssets.test.ts`, then:

```bash
git add src/backend/pwaAssets.ts src/backend/pwaAssets.test.ts
git commit -m "tune(phone): preview profile after on-device measurement"
```

---

## Risks and limits

- Phone heat during long recordings: a 15 fps JPEG encode runs beside H.264 recording. The step-down lowers the preview size if cycles fall behind, but it does not watch temperature. Watch for the phone dimming or throttling on 3-minute takes.
- Wi-Fi: two phones at 15 fps × about 30 KB is about 7 Mbps of previews, on top of 12 Mbps of recording kept on the phones (not sent during recording). A 2.4 GHz network shared with other devices may not hold 15 fps; 5 GHz should.
- Old phone script: a phone that has not reloaded keeps the old rates and still works with the new desktop.
- The capture heartbeat now runs whenever Capture is open, so the desktop receives about 15 previews per second per phone there even when nobody watches the pose overlay. Other screens are unchanged.
