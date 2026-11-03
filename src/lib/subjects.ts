/**
 * Subject profile helpers — load existing reuses info but always retakes postures.
 */

export type SubjectProfile = {
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
  /** Filenames of standing PNGs from a prior session (informational only). */
  standingFiles?: Partial<Record<'F' | 'LL' | 'RL', string>>;
};

/** Demo seed matching Phase 0 Open Design sample subject. */
export const DEMO_SUBJECT: SubjectProfile = {
  subjectId: 'UG0001',
  subjectName: 'Chan Tai Man',
  heightCm: '172',
  weightKg: '68',
};

/**
 * Loading an existing subject fills fields but must force a posture retake —
 * never skip F → LL → RL.
 */
export function loadExistingSubject(profile: SubjectProfile): {
  profile: SubjectProfile;
  retakePostures: true;
  postureDone: false;
  capturedStanding: [];
} {
  return {
    profile: {
      subjectId: profile.subjectId,
      subjectName: profile.subjectName,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      // Prior standing files are not reused for the gate.
      standingFiles: undefined,
    },
    retakePostures: true,
    postureDone: false,
    capturedStanding: [],
  };
}
