/**
 * Camera view roles for KneeVidScan-Desktop.
 * Cam1 Frontal (F), Cam2 Lateral right (L), Cam3 Additional (O).
 * Single camera: no view suffix in filenames.
 */

export const CAM_MAX = 3;

export type ViewCode = 'F' | 'L' | 'O';

export const VIEW_ROLE_LABELS: Record<ViewCode, string> = {
  F: 'Frontal View',
  L: 'Lateral View (right)',
  O: 'Additional view',
};

/** Locked role order for multi-cam sessions. */
export const ROLE_ORDER: ViewCode[] = ['F', 'L', 'O'];

export function assertCamCount(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > CAM_MAX) {
    throw new Error(`Camera count must be 0–${CAM_MAX}, got ${n}`);
  }
}

/**
 * View code for a camera index given total paired count.
 * Single-cam → null (no filename suffix). Multi-cam → F/L/O.
 */
export function viewCodeForIndex(
  camCount: number,
  camIndex: number,
): ViewCode | null {
  assertCamCount(camCount);
  if (camCount < 1) return null;
  if (camIndex < 0 || camIndex >= camCount) {
    throw new Error(
      `Camera index ${camIndex} out of range for count ${camCount}`,
    );
  }
  if (camCount === 1) return null;
  return ROLE_ORDER[camIndex] ?? null;
}

/** Human-readable role for Pair / Capture UI. */
export function roleLabelForIndex(camCount: number, camIndex: number): string {
  const code = viewCodeForIndex(camCount, camIndex);
  if (code === null) {
    return camCount === 1 ? 'No view · single camera' : 'Not paired';
  }
  if (code === 'O') return 'Additional view · any angle';
  return VIEW_ROLE_LABELS[code];
}

/** Filename suffix including leading underscore, or empty for single-cam. */
export function viewSuffix(camCount: number, camIndex: number): string {
  const code = viewCodeForIndex(camCount, camIndex);
  return code ? `_${code}` : '';
}

/** Next slot index when pairing another device, or null if at max. */
export function nextPairingSlot(currentCount: number): number | null {
  assertCamCount(currentCount);
  if (currentCount >= CAM_MAX) return null;
  return currentCount;
}

/** Role that will be assigned when the next device completes pairing. */
export function pendingRoleLabel(currentCount: number): string {
  const slot = nextPairingSlot(currentCount);
  if (slot === null) return 'Maximum of 3 cameras reached';
  // After pairing, roles recompute from final count.
  const futureCount = currentCount + 1;
  return roleLabelForIndex(futureCount, slot);
}

export function canPairMore(currentCount: number): boolean {
  return nextPairingSlot(currentCount) !== null;
}
