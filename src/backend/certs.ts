/**
 * Local HTTPS certificates for phone getUserMedia.
 * Phones must trust / accept the self-signed cert once (see README).
 */

import selfsigned from 'selfsigned';
import os from 'node:os';

export type CertBundle = {
  key: string;
  cert: string;
  /** Hostnames / IPs embedded in the cert SAN list. */
  hosts: string[];
};

export type LanInterface = {
  name: string;
  address: string;
  internal?: boolean;
};

/** VPN and virtual adapters are not reachable from a phone on Wi-Fi. */
const VIRTUAL_ADAPTER =
  /nordlynx|nordvpn|vethernet|hyper-?v|wsl|virtualbox|vmware|vbox|docker|bluetooth|loopback|tailscale|zerotier|hamachi|wireguard|wintun|radmin|tunnel|vpn|tap-|tun/i;

export function isVirtualAdapterName(name: string): boolean {
  return VIRTUAL_ADAPTER.test(name);
}

function lanRank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 1;
  if (address.startsWith('10.')) return 2;
  return 3;
}

/**
 * Address to put in the phone QR. Skips VPN/virtual adapters (NordLynx and
 * similar) and prefers a normal LAN address the phone can route to.
 */
export function chooseLanHost(ifaces: LanInterface[]): string {
  const candidates = ifaces.filter(
    (entry) =>
      entry.address &&
      !entry.internal &&
      entry.address !== '127.0.0.1' &&
      !entry.address.startsWith('169.254.') &&
      !isVirtualAdapterName(entry.name),
  );
  candidates.sort((a, b) => lanRank(a.address) - lanRank(b.address));
  return candidates[0]?.address ?? '127.0.0.1';
}

export function listLanInterfaces(): LanInterface[] {
  const nets = os.networkInterfaces();
  const out: LanInterface[] = [];
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4') {
        out.push({
          name,
          address: entry.address,
          internal: entry.internal,
        });
      }
    }
  }
  return out;
}

export function listLanAddresses(): string[] {
  const out = ['localhost', '127.0.0.1'];
  for (const entry of listLanInterfaces()) {
    if (!entry.internal) out.push(entry.address);
  }
  return [...new Set(out)];
}

/** Prefer a phone-reachable IPv4 for QR URLs. */
export function preferredLanHost(): string {
  return chooseLanHost(listLanInterfaces());
}

export async function generateLocalCerts(
  extraHosts: string[] = [],
): Promise<CertBundle> {
  const hosts = [...new Set([...listLanAddresses(), ...extraHosts])];
  const attrs = [{ name: 'commonName', value: 'KneeVidScan-Desktop Local' }];
  const altNames = hosts.map((value) => {
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(value);
    return isIp ? { type: 7 as const, ip: value } : { type: 2 as const, value };
  });

  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60_000),
    notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    extensions: [
      // End-entity server cert. CA:true makes phones show a blank TLS error.
      { name: 'basicConstraints', cA: false },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
      },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames,
      },
    ],
  });

  return {
    key: pems.private,
    cert: pems.cert,
    hosts,
  };
}
