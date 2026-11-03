/**
 * Device pairing helpers (Lite-sized MotusCap-inspired API shape).
 * QR URL carries api, device_pairing_id, optional device_pairing_code.
 */

import { CAM_MAX, canPairMore } from './roles';

export type PairingStatus = 'pending' | 'completed' | 'expired' | 'cancelled';

export type PairedDevice = {
  deviceId: string;
  name: string;
  camIndex: number;
  pairedAt: number;
  /** Present after roles recompute; null for single-cam. */
  viewCode: 'F' | 'L' | 'O' | null;
};

export type DevicePairing = {
  id: string;
  code: string;
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
  /** Slot reserved for this pairing (0–2). */
  reservedIndex: number;
  deviceId?: string;
  /** Re-pair: this camera is swapped out (same slot) once the new phone completes. */
  replaceDeviceId?: string;
  /** Full URL encoded in the QR, so a reload can show the same code again. */
  qrUrl?: string;
};

export type PairingQrParams = {
  api: string;
  device_pairing_id: string;
  device_pairing_code?: string;
  /** HTTPS origin used for the camera page. */
  secure?: string;
};

const PAIRING_TTL_MS = 10 * 60 * 1000;

export function pairingTtlMs(): number {
  return PAIRING_TTL_MS;
}

export function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${prefix}_${hex}`;
}

/** Short human-readable pairing code (shown under QR). */
export function randomPairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let out = 'MCAP-';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function buildPairingQrUrl(
  pwaBase: string,
  params: PairingQrParams,
): string {
  const url = new URL(pwaBase.endsWith('/') ? `${pwaBase}` : `${pwaBase}/`);
  // Keep path as /pwa/ — query params on the PWA entry.
  if (!url.pathname.includes('pwa')) {
    url.pathname = '/pwa/';
  }
  url.searchParams.set('api', params.api);
  url.searchParams.set('device_pairing_id', params.device_pairing_id);
  if (params.device_pairing_code) {
    url.searchParams.set('device_pairing_code', params.device_pairing_code);
  }
  if (params.secure) {
    url.searchParams.set('secure', params.secure);
  }
  return url.toString();
}

export function parsePairingQrUrl(qrUrl: string): PairingQrParams | null {
  try {
    const url = new URL(qrUrl);
    const api = url.searchParams.get('api');
    const id = url.searchParams.get('device_pairing_id');
    if (!api || !id) return null;
    const code = url.searchParams.get('device_pairing_code') ?? undefined;
    const secure = url.searchParams.get('secure') ?? undefined;
    return {
      api,
      device_pairing_id: id,
      device_pairing_code: code,
      ...(secure ? { secure } : {}),
    };
  } catch {
    return null;
  }
}

export function validateNewPairing(currentDeviceCount: number):
  | {
      ok: true;
      reservedIndex: number;
    }
  | { ok: false; error: string } {
  if (!canPairMore(currentDeviceCount)) {
    return { ok: false, error: `Maximum of ${CAM_MAX} cameras reached` };
  }
  return { ok: true, reservedIndex: currentDeviceCount };
}

export function isPairingExpired(
  pairing: DevicePairing,
  now = Date.now(),
): boolean {
  return pairing.status === 'pending' && now >= pairing.expiresAt;
}
