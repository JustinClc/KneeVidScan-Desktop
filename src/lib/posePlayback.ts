/** Last pose frame whose timestamp is at or before `timeSec`. */
export function frameIndexAtTime(
  frames: ReadonlyArray<{ time_s: number }>,
  timeSec: number,
): number {
  if (frames.length === 0) return 0;
  let idx = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].time_s <= timeSec + 1e-4) idx = i;
    else break;
  }
  return idx;
}
