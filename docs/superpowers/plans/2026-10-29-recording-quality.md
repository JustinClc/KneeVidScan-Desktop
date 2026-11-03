# Recording Quality and FPS Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Capture, let operators pick Auto/1080p/720p/480p (paired bitrates), see rough per-option FPS from a light probe, apply a session-wide preset to phone recording, mildly ease preview during recording, and allow turning preview off for bandwidth.

**Architecture:** Pure helpers in `src/lib/recordingQuality.ts` define presets, FPS estimates, and weakest-phone recommendation. Session state lives in `BackendStore` and is pushed to phones on `GET /v1/devices/:id/still-request`. Phones POST probe samples and apply resolution/bitrate when idle. Capture sidebar owns the UI; CamFeed shows a preview-off placeholder.

**Tech Stack:** TypeScript helpers + Vitest, Electron local HTTPS backend (`server.ts` / `store.ts`), phone PWA string in `pwaAssets.ts` (helpers tested in a VM), React Capture UI + `messages.ts` locales.

## Global Constraints

- Prefer estimated **≥30 fps**; keep **1080p when every phone’s estimate allows it**.
- Presets are **session-wide**; Auto uses the **weakest** paired phone.
- Light probe only: `getSettings()` + ~64 KiB upload sample — no multi-rung encode calibrate.
- Standing stills / standing preview profiles **unchanged**.
- Quality editable on Capture only when **idle**; locked from Start/arm through upload done.
- Preview-off default **on** (previews enabled); toggle works during recording; **not** persisted across sessions.
- Milder recording-time preview: modest drop vs current Capture LAN (~15→~10 fps, smaller JPEG), not a hard 2–5 fps throttle.
- Design spec: `docs/superpowers/specs/2026-10-29-recording-quality-design.md`.

## File structure

| File                                                  | Role                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Create `src/lib/recordingQuality.ts`                  | Presets, estimate/recommend helpers                           |
| Create `src/lib/recordingQuality.test.ts`             | Unit tests for helpers                                        |
| Modify `src/backend/store.ts`                         | Session quality mode, resolved preset, previewEnabled, probes |
| Modify `src/backend/server.ts`                        | Settings + probe routes; extend still-request                 |
| Modify `src/backend/server.test.ts` / `store.test.ts` | API/store coverage                                            |
| Modify `src/lib/backendClient.ts`                     | Client methods                                                |
| Modify `src/backend/pwaAssets.ts`                     | Apply preset, probe, milder preview, previewEnabled           |
| Modify `src/backend/pwaAssets.test.ts`                | Helper VM tests                                               |
| Modify `src/screens/Capture.tsx`                      | Sidebar UI + probe/refresh + lock                             |
| Modify `src/components/CamFeed.tsx`                   | Preview-off placeholder                                       |
| Modify `src/state/SessionContext.tsx`                 | Thin UI state if needed (or Capture-local + backend)          |
| Modify `src/lib/messages.ts`                          | en / zh-Hant / zh-Hans copy                                   |
| Modify `docs/CONTEXT.md`                              | One-line note under Capture / Full-res                        |

---

### Task 1: Recording quality helpers

**Files:**

- Create: `src/lib/recordingQuality.ts`
- Test: `src/lib/recordingQuality.test.ts`

**Interfaces:**

- Produces:
  - `RecordingPresetId = '1080p' | '720p' | '480p'`
  - `RecordingQualityMode = 'auto' | RecordingPresetId`
  - `RECORDING_PRESETS: Record<RecordingPresetId, { id; longSide; shortSide; videoBitsPerSecond; label }>`
  - `LinkProbeSample = { width: number; height: number; frameRate: number; uploadBytesPerSec: number }`
  - `estimateFps(preset: RecordingPresetId, probe: LinkProbeSample): number`
  - `recommendPreset(probes: LinkProbeSample[]): RecordingPresetId`
  - `resolvePreset(mode: RecordingQualityMode, probes: LinkProbeSample[]): RecordingPresetId`
  - `TARGET_MIN_FPS = 30`
  - `PROBE_BODY_BYTES = 64 * 1024`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  RECORDING_PRESETS,
  TARGET_MIN_FPS,
  estimateFps,
  recommendPreset,
  resolvePreset,
  type LinkProbeSample,
} from './recordingQuality';

const strong: LinkProbeSample = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  uploadBytesPerSec: 2_000_000,
};
const weak: LinkProbeSample = {
  width: 1920,
  height: 1080,
  frameRate: 24,
  uploadBytesPerSec: 80_000,
};

describe('recordingQuality', () => {
  it('defines paired bitrates for each preset', () => {
    expect(RECORDING_PRESETS['1080p'].videoBitsPerSecond).toBe(6_000_000);
    expect(RECORDING_PRESETS['720p'].videoBitsPerSecond).toBe(3_500_000);
    expect(RECORDING_PRESETS['480p'].videoBitsPerSecond).toBe(1_750_000);
  });

  it('estimates higher fps for lower presets on a weak link', () => {
    expect(estimateFps('480p', weak)).toBeGreaterThan(
      estimateFps('1080p', weak),
    );
  });

  it('recommends the highest preset that clears TARGET_MIN_FPS for every phone', () => {
    expect(recommendPreset([strong])).toBe('1080p');
    expect(recommendPreset([strong, weak])).not.toBe('1080p');
    expect(recommendPreset([])).toBe('720p');
  });

  it('resolvePreset honors explicit mode over auto', () => {
    expect(resolvePreset('480p', [strong])).toBe('480p');
    expect(resolvePreset('auto', [strong])).toBe(recommendPreset([strong]));
  });

  it('keeps TARGET_MIN_FPS at 30', () => {
    expect(TARGET_MIN_FPS).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm exec vitest run src/lib/recordingQuality.test.ts`

- [ ] **Step 3: Implement helpers**

```ts
export type RecordingPresetId = '1080p' | '720p' | '480p';
export type RecordingQualityMode = 'auto' | RecordingPresetId;

export const TARGET_MIN_FPS = 30;
export const PROBE_BODY_BYTES = 64 * 1024;

export const RECORDING_PRESETS: Record<
  RecordingPresetId,
  {
    id: RecordingPresetId;
    longSide: number;
    shortSide: number;
    videoBitsPerSecond: number;
    label: string;
  }
> = {
  '1080p': {
    id: '1080p',
    longSide: 1920,
    shortSide: 1080,
    videoBitsPerSecond: 6_000_000,
    label: '1080p',
  },
  '720p': {
    id: '720p',
    longSide: 1280,
    shortSide: 720,
    videoBitsPerSecond: 3_500_000,
    label: '720p',
  },
  '480p': {
    id: '480p',
    longSide: 854,
    shortSide: 480,
    videoBitsPerSecond: 1_750_000,
    label: '480p',
  },
};

export type LinkProbeSample = {
  width: number;
  height: number;
  frameRate: number;
  uploadBytesPerSec: number;
};

const PRESET_ORDER: RecordingPresetId[] = ['1080p', '720p', '480p'];

/** Rough FPS guess: camera cap, pixel load vs 1080p, and upload headroom. */
export function estimateFps(
  presetId: RecordingPresetId,
  probe: LinkProbeSample,
): number {
  const preset = RECORDING_PRESETS[presetId];
  const camFps =
    probe.frameRate > 0 && Number.isFinite(probe.frameRate)
      ? probe.frameRate
      : 30;
  const refPixels = 1920 * 1080;
  const presetPixels = preset.longSide * preset.shortSide;
  const pixelFactor = Math.sqrt(refPixels / Math.max(1, presetPixels));
  let fps = camFps * Math.min(1.15, Math.max(0.55, pixelFactor));
  // Local recording does not stream video live; weak upload mainly signals
  // contention with preview/other traffic — scale gently.
  const comfortable = preset.videoBitsPerSecond / 8 / 4;
  if (probe.uploadBytesPerSec > 0 && probe.uploadBytesPerSec < comfortable) {
    fps *= Math.max(0.4, probe.uploadBytesPerSec / comfortable);
  }
  return Math.max(1, Math.min(Math.round(fps), Math.round(camFps)));
}

export function recommendPreset(probes: LinkProbeSample[]): RecordingPresetId {
  if (!probes.length) return '720p';
  for (const id of PRESET_ORDER) {
    if (probes.every((p) => estimateFps(id, p) >= TARGET_MIN_FPS)) return id;
  }
  return '480p';
}

export function resolvePreset(
  mode: RecordingQualityMode,
  probes: LinkProbeSample[],
): RecordingPresetId {
  if (mode === 'auto') return recommendPreset(probes);
  return mode;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm exec vitest run src/lib/recordingQuality.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/recordingQuality.ts src/lib/recordingQuality.test.ts
git commit -m "feat(quality): add recording preset and FPS estimate helpers"
```

---

### Task 2: Store session recording settings + probes

**Files:**

- Modify: `src/backend/store.ts`
- Test: `src/backend/store.test.ts`

**Interfaces:**

- Consumes: types from `recordingQuality.ts`
- Produces on `BackendStore`:
  - `recordingQualityMode: RecordingQualityMode` (default `'auto'`)
  - `previewEnabled: boolean` (default `true`)
  - `linkProbes: Map<string, LinkProbeSample>`
  - `setRecordingQualityMode(mode)`, `setPreviewEnabled(on)`, `setLinkProbe(deviceId, sample)`, `clearLinkProbe(deviceId)`
  - `listLinkProbes(): LinkProbeSample[]`
  - `resolvedRecordingPreset(): RecordingPresetId` using `resolvePreset`
  - Clear probes when a device is removed / unpaired

- [ ] **Step 1: Write failing store tests** for default auto, set mode, preview toggle, probe replace, resolved preset follows weakest, probe cleared on device remove.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run src/backend/store.test.ts`

- [ ] **Step 3: Implement store fields/methods** (import helpers; keep standing/livePose maps unchanged).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/backend/store.ts src/backend/store.test.ts
git commit -m "feat(store): session recording quality mode, preview flag, link probes"
```

---

### Task 3: HTTP API + still-request fields

**Files:**

- Modify: `src/backend/server.ts`
- Modify: `src/backend/server.test.ts`
- Modify: `src/lib/backendClient.ts`

**Interfaces:**

- `GET /v1/session/recording-quality` → `{ mode, resolved, previewEnabled, recommendation, estimates: Record<presetId, number>, probes: number }`
  - `estimates` = per-preset `min(estimateFps)` across probes (or single-probe values); empty probes → estimates from a synthetic mid probe or zeros + recommendation `720p`.
- `POST /v1/session/recording-quality` body `{ mode?: RecordingQualityMode, previewEnabled?: boolean }` → same shape as GET after update.
- `POST /v1/devices/:id/link-probe` (Bearer) body `LinkProbeSample` → `{ ok: true }`.
- Extend `GET …/still-request` JSON with:
  - `recordingPreset: RecordingPresetId` (resolved)
  - `videoBitsPerSecond: number`
  - `previewEnabled: boolean`
  - `probeRequested: boolean` — true when desktop wants a fresh sample (see Task 5: store a `probeGeneration` or `probeNeededUntil` flag desktop sets)

Keep responses backward compatible: old phones ignore new fields.

- [ ] **Step 1: Failing server tests** for GET/POST settings, probe auth, still-request extras.

- [ ] **Step 2: Implement routes + `backendClient` methods:**
  - `getRecordingQuality()`
  - `setRecordingQuality(partial)`
  - `requestLinkProbes()` (sets probe-needed for all devices)
  - phones already use raw fetch for probe POST inside PWA

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "feat(api): recording quality settings and link-probe endpoint"
```

---

### Task 4: Phone — apply preset, bitrate, milder recording preview, previewEnabled

**Files:**

- Modify: `src/backend/pwaAssets.ts` (`PWA_HELPERS_JS` + `PWA_JS`)
- Modify: `src/backend/pwaAssets.test.ts`

**Interfaces (inside helpers / phone script):**

- Extend `PREVIEW_PROFILES` with capture-recording profiles, e.g. LAN `{ intervalMs: 100, longSide: 360, quality: 0.5 }`, public `{ intervalMs: 250, longSide: 280, quality: 0.5 }`.
- `previewMode()` returns `'standing' | 'capture' | 'captureRecording' | 'idle'` — use `captureRecording` when `captureMode && session`.
- `resolutionConstraints(maxRes, presetId)` — standing max-res unchanged; else use preset long/short ideals.
- Read `recordingPreset`, `videoBitsPerSecond`, `previewEnabled`, `probeRequested` from still-request.
- Skip preview POST when `!previewEnabled`.
- `MediaRecorder(…, { videoBitsPerSecond })` from server field (fallback 6_000_000).
- On `probeRequested`, run light probe once and `POST /v1/devices/:id/link-probe`.

Light probe sketch in phone script:

```js
async function runLinkProbe() {
  const track = mediaStream && mediaStream.getVideoTracks()[0];
  const s = (track && track.getSettings()) || {};
  const body = new Uint8Array(PROBE_BODY_BYTES);
  const t0 = Date.now();
  await fetch(
    api + '/v1/devices/' + encodeURIComponent(deviceId) + '/link-probe-bytes',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
      },
      body,
    },
  );
  // Prefer measuring via dedicated bytes sink OR time the JSON probe POST with a padded field.
  // Simpler approach used in implementation: POST JSON sample after timing a POST of PROBE_BODY_BYTES
  // to `/v1/devices/:id/link-probe-bytes` that discards the body and returns { ok, received }.
  const uploadBytesPerSec =
    body.length / Math.max(0.001, (Date.now() - t0) / 1000);
  await fetch(
    api + '/v1/devices/' + encodeURIComponent(deviceId) + '/link-probe',
    {
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
    },
  );
}
```

Add `POST …/link-probe-bytes` in Task 3 if not folded into timing the JSON route with a multipart body — prefer **one** `link-probe` JSON route and measure RTT of a prior `POST …/preview` of a generated JPEG only if simpler; **canonical:** `POST link-probe-bytes` discard + `POST link-probe` JSON as above.

Apply constraints when still-request preset changes and `!session && !standingMode`.

- [ ] **Step 1: VM tests** for new `previewProfile('captureRecording', lan)`, preset constraint helper if extracted, `PREVIEW_MIN_LONG_SIDE.captureRecording`.

- [ ] **Step 2: Implement phone script changes.**

- [ ] **Step 3: `pnpm exec vitest run src/backend/pwaAssets.test.ts` PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(phone): apply recording preset, milder record preview, preview off"
```

---

### Task 5: Capture UI — picker, estimates, Refresh, warning, preview toggle

**Files:**

- Modify: `src/screens/Capture.tsx`
- Modify: `src/components/CamFeed.tsx` (+ `CamGrid` props as needed)
- Modify: `src/lib/messages.ts` (en + zh-Hant + zh-Hans)
- Modify: `src/App.test.tsx` only if Capture selectors need coverage

**UI (Capture sidebar, above or below pose switch):**

1. Label **Recording quality**
2. `<select>` options: Auto (recommended 720p), 1080p (~28 fps), 720p (~32 fps), 480p (~34 fps) — format with live estimates from GET
3. Badge/text: **Recommended: {preset}**
4. Button **Refresh** → `requestLinkProbes()` then poll GET until probe count matches devices or timeout ~3s
5. Caution `<small>` when explicit mode’s estimate &lt;30 or mode preset is higher than recommendation
6. Toggle **Live preview** (checked = previewEnabled); works while recording; onChange → `setRecordingQuality({ previewEnabled })`
7. Disable quality `<select>` when `recording || countdown != null` (arm/record lock). Do **not** disable preview toggle during recording.

On mount / `deviceIds` change: `setRecordingQuality` unchanged, call Refresh probe once.

Pass `previewEnabled` into `CamGrid`/`CamFeed`: when false, skip `nextPreview` long-poll and show `t('Preview off')` placeholder (keep last frame optional — prefer clear placeholder).

- [ ] **Step 1: Add locale strings** for all new English keys in both Chinese tables.

- [ ] **Step 2: Wire Capture + CamFeed.**

- [ ] **Step 3: Manual sanity** via existing app if available; at minimum `pnpm test` + `pnpm typecheck`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(capture): recording quality picker, FPS estimates, preview toggle"
```

---

### Task 6: Docs + regression sweep

**Files:**

- Modify: `docs/CONTEXT.md` (Full-res / Capture notes)
- Optionally one line in `README.md` Capture section if present

- [ ] **Step 1: Document** that trial recording quality is operator-selectable on Capture; Standing stills unchanged; previews can be disabled.

- [ ] **Step 2: Run full suite**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: recording quality and preview-off behavior"
```

---

## Self-review checklist

- [x] Spec coverage: presets, Auto, estimates, weakest phone, light probe, Capture UI, lock window, milder preview, preview-off, standing untouched, override warning
- [x] No per-camera / bitrate slider / WebRTC / standing coupling
- [x] Types align: `RecordingPresetId`, `LinkProbeSample`, still-request fields
- [x] Phone learns settings via existing still-request poll pattern

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-29-recording-quality.md` (spec at `docs/superpowers/specs/2026-10-29-recording-quality-design.md`).

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach?
