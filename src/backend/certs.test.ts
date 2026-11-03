/** @vitest-environment node */
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chooseLanHost, generateLocalCerts } from './certs';

describe('chooseLanHost', () => {
  it('uses the LAN adapter when a VPN adapter is listed first', () => {
    expect(
      chooseLanHost([
        { name: 'NordLynx', address: '10.5.0.2' },
        { name: 'Ethernet', address: '192.168.1.8' },
        {
          name: 'Loopback Pseudo-Interface 1',
          address: '127.0.0.1',
          internal: true,
        },
      ]),
    ).toBe('192.168.1.8');
  });

  it('falls back to loopback when every adapter is virtual', () => {
    expect(chooseLanHost([{ name: 'NordLynx', address: '10.5.0.2' }])).toBe(
      '127.0.0.1',
    );
  });

  it('issues an end-entity server certificate for the LAN address', async () => {
    const bundle = await generateLocalCerts(['192.168.1.8']);
    const cert = new X509Certificate(bundle.cert);
    expect(cert.ca).toBe(false);
    expect(cert.subjectAltName).toContain('IP Address:192.168.1.8');
    expect(cert.subjectAltName).toContain('DNS:localhost');
  });
});
