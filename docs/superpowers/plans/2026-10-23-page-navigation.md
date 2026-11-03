# Page navigation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Back and Pair cameras navigation from Subject, Capture, Review, and Pose, with an inline Leave / Stay confirm while work is in progress.

**Architecture:** `LeaveButton` renders one ghost button. When `busy` is true it shows an inline confirm (same markup as Re-pair) instead of navigating. `LeaveGroup` keeps only one confirm open among sibling buttons. Each screen passes its own busy flag, message, and `beforeLeave`. `go(screen)` is unchanged and does not reset session state.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

## Global Constraints

- Subject has one button, **Back to pairing**, because its previous step is pairing.
- Capture renames **← Subject** to **Back** and adds **Pair cameras**. Both confirm only while a recording is running. Leave calls the existing silent stop (`stopRec(true)`), which keeps the trial.
- Review keeps **Record another** as the way back to Capture. **Pair cameras** never confirms. Both pause playback, then navigate.
- Pose keeps **← Back to review** and adds **Pair cameras**. Both confirm only while a re-run is running. Leave does not cancel the re-run.
- Subject confirms during standing phases `count`, `capturing`, and `review`. Leave discards only the photo in progress. A countdown interval is cleared on unmount.
- Confirm copy is exactly: "Leave Capture? The recording stops and the trial is kept." / "Leave Subject? The photo in progress is discarded; accepted photos are kept." / "Leave Pose? The re-run continues and its result is saved to this trial."
- New Session and Pair are unchanged.

---

### Task 1: LeaveButton

**Files:**

- Create: `src/components/LeaveButton.tsx`
- Test: `src/App.test.tsx` (navigation cases added in Task 2; the component is exercised through the screens)

**Interfaces:**

- Produces: `LeaveGroup({ children })`, `LeaveButton({ label, target, busy, confirmText, beforeLeave?, testId, className? })` where `target` is `ScreenId`.

- [x] **Step 1: Add the component**

`LeaveButton` uses `useSession().go`. Outside a group it keeps its own open flag. Inside `LeaveGroup`, the open id is the button `testId`, so opening one confirm closes another. **Leave** awaits `beforeLeave` then `go(target)`. **Stay** only closes the confirm. When `busy` is false the button does that immediately. Confirm markup uses class `slot-confirm`, test ids `${testId}-confirm`, `${testId}-leave`, `${testId}-stay`.

- [x] **Step 2: Commit** the component with the screen wiring in Task 2 so the tests cover it.

### Task 2: Wire the four screens and test

**Files:**

- Modify: `src/screens/Subject.tsx`, `src/screens/Capture.tsx`, `src/screens/Review.tsx`, `src/screens/Pose.tsx`
- Modify: `src/App.test.tsx`
- Test command: `pnpm exec vitest run src/App.test.tsx`

- [x] **Step 1: Write failing tests** in `App.test.tsx`:
  - Subject shows **Back to pairing** and, with nothing in progress, opens Pair with the camera still connected. During **Capture now**, the confirm appears; **Stay** stays on Subject; **Leave** opens Pair.
  - Capture shows **Back** and **Pair cameras**. With no recording, **Pair cameras** opens Pair. During a recording, **Pair cameras** confirms; **Stay** keeps Capture and the recording; **Leave** calls `stopTrial` and opens Pair with the camera still connected. Opening **Back** while the Pair confirm is open shows only the Back confirm.
  - Review **Pair cameras** opens Pair with the camera still connected, with no confirm.
  - Pose **Pair cameras** opens Pair with the camera still connected. While a re-run is pending, **Pair cameras** confirms; **Stay** stays on Pose; **Leave** on **← Back to review** opens Review.

- [x] **Step 2: Run the tests and confirm they fail** because the buttons are missing.

- [x] **Step 3: Wire the screens**
  - Subject actions row: `LeaveButton` **Back to pairing**, `target={2}`, busy on `count` | `capturing` | `review`. Clear the countdown interval when Subject unmounts.
  - Capture sidebar bottom: `LeaveGroup` with **Back** (`target={4}`, `testId="capture-back"`, `btn btn-ghost btn-sm`) and **Pair cameras** (`target={2}`, `testId="capture-pair-cameras"`). `busy={recording}`. `beforeLeave` is `() => stopRec(true)` only while recording.
  - Review header actions, after **Record another**: **Pair cameras** (`testId="review-pair-cameras"`, `busy={false}`, `beforeLeave={pause}`).
  - Pose footer: replace the back button with `LeaveButton` (`testId="pose-back-review"`, `target={6}`) and add **Pair cameras** (`testId="pose-pair-cameras"`, `target={2}`) inside one `LeaveGroup`. `busy={running}`.

- [x] **Step 4: Run `pnpm exec vitest run src/App.test.tsx`, `pnpm typecheck`, and `pnpm lint`.** Expected: pass.

- [x] **Step 5: Commit** `feat: add Back and Pair cameras navigation`
