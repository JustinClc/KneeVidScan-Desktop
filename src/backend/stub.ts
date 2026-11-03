/**
 * Legacy Phase 0 stub — real local backend lives in server.ts (Phase 1).
 */
export const BACKEND_STUB = {
  name: 'motuscap-lite-backend',
  status: 'phase1' as const,
  note: 'Local HTTPS backend serves pairing, shared start, preview, and the phone PWA.',
};

export function describeBackendStub(): string {
  return `${BACKEND_STUB.name}: ${BACKEND_STUB.status} — ${BACKEND_STUB.note}`;
}
