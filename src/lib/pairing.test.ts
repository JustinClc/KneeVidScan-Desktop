import { describe, expect, it } from 'vitest';
import {
  buildPairingQrUrl,
  parsePairingQrUrl,
  validateNewPairing,
} from './pairing';

describe('pairing', () => {
  it('builds and parses QR URLs with api + pairing id + code', () => {
    const qr = buildPairingQrUrl('https://192.168.1.10:8443/pwa/', {
      api: 'https://192.168.1.10:8443',
      device_pairing_id: 'dp_abc',
      device_pairing_code: 'MCAP-TEST',
    });
    expect(qr).toContain('device_pairing_id=dp_abc');
    expect(qr).toContain('device_pairing_code=MCAP-TEST');
    expect(qr).toContain('api=');
    const parsed = parsePairingQrUrl(qr);
    expect(parsed).toEqual({
      api: 'https://192.168.1.10:8443',
      device_pairing_id: 'dp_abc',
      device_pairing_code: 'MCAP-TEST',
    });
  });

  it('rejects pairing beyond 3 cameras', () => {
    expect(validateNewPairing(3).ok).toBe(false);
    expect(validateNewPairing(2)).toEqual({ ok: true, reservedIndex: 2 });
  });
});
