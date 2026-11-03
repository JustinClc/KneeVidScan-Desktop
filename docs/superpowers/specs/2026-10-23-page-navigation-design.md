# Page navigation: Back and Pair cameras

## Goal

From every page after pairing, the operator can return to the previous step
and jump straight back to the device pairing page. Moving between pages never
resets the session: paired cameras, subject, standing photos, trials and pose
results are kept.

Device deletion on its own is out of scope; in-place **Re-pair** on the
pairing page already covers swapping a phone.

## Buttons per page

Flow: New Session (1) → Pair (2) → Subject (4) → Capture (5) → Review (6) →
Pose (7).

| Page        | Previous step                               | Pairing                                                                           |
| ----------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| New Session | —                                           | — (unchanged)                                                                     |
| Pair        | **Back** to New Session (unchanged)         | —                                                                                 |
| Subject     | —                                           | **Back to pairing** (`go(2)`); single button because the previous step is pairing |
| Capture     | **← Subject** renamed to **Back** (`go(4)`) | **Pair cameras** (`go(2)`), new                                                   |
| Review      | **Record another** (`go(5)`), unchanged     | **Pair cameras** (`go(2)`), new                                                   |
| Pose        | **← Back to review** (`go(6)`), unchanged   | **Pair cameras** (`go(2)`), new                                                   |

Placement, using the existing `btn btn-ghost` style:

- Subject: in the standing-posture `actions` row next to
  **Save Subject & continue**.
- Capture: the bottom of the left sidebar, where **← Subject** sits today.
- Review: the header `actions` row, after **Record another**.
- Pose: the `pp-foot` row, after **← Back to review**.

## Confirm before leaving

A page asks for confirmation only while work is in progress; otherwise the
button navigates immediately. The confirm is an inline box beside the button,
styled like the Re-pair confirm on the pairing page (`slot-confirm`), with
**Leave** and **Stay**. **Stay** closes the box and does nothing else.

| Page    | In progress when                                                                                                  | Message                                                                      | On Leave                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Capture | a recording is running                                                                                            | Leave Capture? The recording stops and the trial is kept.                    | `stopRec(true)` (silent stop, trial recorded), then navigate                        |
| Subject | a standing countdown is running, or a photo is taken but not yet accepted (`count`, `capturing`, `review` phases) | Leave Subject? The photo in progress is discarded; accepted photos are kept. | navigate; unmounting drops the pending photo, accepted photos stay in session state |
| Pose    | a pose re-run is running                                                                                          | Leave Pose? The re-run continues and its result is saved to this trial.      | navigate; the re-run keeps going and stores its result via `setTrialPose`           |
| Review  | never                                                                                                             | —                                                                            | pause playback, then navigate                                                       |

Pose re-runs are not cancellable (`runFullResPoseEstimation` takes no abort
signal), so leaving does not stop them. The "Pose ready" toast still shows on
whichever page is open when the re-run finishes.

## Implementation

- New shared component `src/components/LeaveButton.tsx`: renders one ghost
  button and, when `busy` is true, an inline Leave / Stay confirm instead of
  navigating. Props: `label`, `target: ScreenId`, `busy: boolean`,
  `confirmText: string`, optional `beforeLeave: () => void | Promise<void>`,
  `testId`. On activation (directly, or via **Leave**) it awaits
  `beforeLeave` and calls `go(target)`.
- Each page passes its own `busy`, message and `beforeLeave`. Navigation still
  goes through `go(screen)` in `SessionContext`; no session state is reset.
- Only one confirm is open at a time per page; opening one closes the other.

## Testing

In `src/App.test.tsx`:

- Each page renders the expected buttons (and Subject has a single
  **Back to pairing**).
- With nothing in progress, the buttons navigate to the right page.
- On Capture during a recording, **Pair cameras** shows the confirm; **Stay**
  keeps Capture and the recording; **Leave** stops the recording, records the
  trial and opens the pairing page.
- **Pair cameras** from Review and from Pose opens the pairing page with the
  paired cameras still listed.
