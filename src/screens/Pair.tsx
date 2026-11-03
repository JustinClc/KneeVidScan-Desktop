import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { IMU_SLOTS } from '../lib/imu';
import { backendClient } from '../lib/backendClient';
import { CAM_MAX, CAM_PHONES, VIEW_ROLES } from '../lib/steps';
import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';

/** Live JPEG from a paired phone. Empty until the phone posts a frame. */
function SlotPreview({ deviceId }: { deviceId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const tick = async () => {
      try {
        const res = await fetch(backendClient.previewUrl(deviceId, Date.now()));
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled || blob.size === 0) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        /* phone has not posted a frame yet */
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deviceId]);

  if (!url) return null;
  return (
    <>
      <img className="slot-preview" src={url} alt="" />
      <span className="live">{t('LIVE')}</span>
    </>
  );
}

const PUBLIC_URL_KEY = 'motuscap-lite.publicBaseUrl';
const QR_VIA_KEY = 'motuscap-lite.qrVia';

/** Which address the pairing QR points the phone at. */
type QrVia = 'local' | 'public';

function savedQrVia(): QrVia {
  const saved = localStorage.getItem(QR_VIA_KEY);
  if (saved === 'local' || saved === 'public') return saved;
  // Older builds used the public URL whenever one was saved.
  return localStorage.getItem(PUBLIC_URL_KEY)?.trim() ? 'public' : 'local';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Intended role for each slot; unpaired slots still show target role (not “Waiting”). */
function slotRole(camCount: number, i: number) {
  if (camCount === 1 && i === 0) {
    return <em className="role none">{t('No view · single camera')}</em>;
  }
  if (i < 2) return <em className="role">{t(VIEW_ROLES[i])}</em>;
  return <em className="role none">{t('Additional view · any angle')}</em>;
}

export function Pair() {
  const {
    camCount,
    devices,
    qrActive,
    activePairing,
    connectedImus,
    hasImus,
    backend,
    backendReady,
    toggleConnectedImu,
    startPairing,
    cancelPairing,
    mockCompletePairing,
    refreshDevices,
    go,
    setFlow,
    showToast,
  } = useSession();
  useLocale();

  const maxed = camCount >= CAM_MAX;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrDrawError, setQrDrawError] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState(
    () => localStorage.getItem(PUBLIC_URL_KEY) ?? '',
  );
  const [qrVia, setQrVia] = useState<QrVia>(savedQrVia);
  const pagePort = backend ? new URL(backend.pwaBase).port : '';
  const localHost = backend ? hostOf(backend.pwaBase) : '';
  const chooseQrVia = (via: QrVia) => {
    setQrVia(via);
    localStorage.setItem(QR_VIA_KEY, via);
  };
  /** After Scan, show chips even if the operator clears every slot. */
  const [imuPickerOpen, setImuPickerOpen] = useState(hasImus);

  useEffect(() => {
    if (hasImus) setImuPickerOpen(true);
  }, [hasImus]);

  useEffect(() => {
    let cancelled = false;
    if (!activePairing?.qrUrl) {
      setQrDataUrl(null);
      setQrDrawError(null);
      return;
    }
    const opts = {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'H' as const,
      color: { dark: '#151922', light: '#ffffff' },
    };
    const qrUrl = activePairing.qrUrl;
    setQrDrawError(null);
    const drawSvg = () =>
      QRCode.toString(qrUrl, { ...opts, type: 'svg' }).then(
        (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      );
    void QRCode.toDataURL(qrUrl, opts)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() =>
        drawSvg()
          .then((url) => {
            if (!cancelled) setQrDataUrl(url);
          })
          .catch(() => {
            if (!cancelled) {
              setQrDataUrl(null);
              setQrDrawError(t('Could not draw the QR code'));
            }
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [activePairing?.qrUrl]);

  // Phones can switch to another of their cameras; pick up the new names.
  useEffect(() => {
    if (!camCount) return;
    const timer = window.setInterval(() => void refreshDevices(), 2000);
    return () => window.clearInterval(timer);
  }, [camCount, refreshDevices]);

  /** Slot whose Re-pair confirm is open. */
  const [confirmRepair, setConfirmRepair] = useState<number | null>(null);
  /** Slot whose Remove device confirm is open. */
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const replacing = Boolean(activePairing?.replaceDeviceId);
  const qrSlot = activePairing?.reservedIndex ?? camCount;

  const requestQr = async (replaceDeviceId?: string) => {
    const trimmed = publicUrl.trim();
    localStorage.setItem(PUBLIC_URL_KEY, trimmed);
    if (qrVia === 'public' && !trimmed) {
      throw new Error(
        t('Enter the public https:// address, or switch to Local network'),
      );
    }
    await startPairing(
      qrVia === 'public' ? trimmed : undefined,
      replaceDeviceId,
    );
  };
  const activeVia: QrVia | null = activePairing
    ? backend && hostOf(activePairing.qrUrl) === hostOf(backend.pwaBase)
      ? 'local'
      : 'public'
    : null;

  const pairNext = async () => {
    if (camCount >= CAM_MAX) return;
    try {
      await requestQr();
      showToast(t('New QR code for Cam {n}', { n: camCount + 1 }));
    } catch (e) {
      showToast(t(e instanceof Error ? e.message : 'Could not start pairing'));
    }
  };

  const repair = async (slot: number) => {
    const device = devices[slot];
    setConfirmRepair(null);
    if (!device) return;
    try {
      await requestQr(device.deviceId);
      showToast(t('New QR code to re-pair Cam {n}', { n: slot + 1 }));
    } catch (e) {
      showToast(
        t(e instanceof Error ? e.message : 'Could not start re-pairing'),
      );
    }
  };

  const removeCamera = async (slot: number) => {
    const device = devices[slot];
    setConfirmRemove(null);
    if (!device) return;
    try {
      await backendClient.removeDevice(device.deviceId);
      await refreshDevices();
      showToast(t('Cam {n} disconnected', { n: slot + 1 }));
    } catch (e) {
      showToast(
        t(e instanceof Error ? e.message : 'Could not remove the camera'),
      );
    }
  };

  const simulateScan = async () => {
    if (!qrActive) return;
    try {
      await mockCompletePairing();
      showToast(t('Simulated phone only — no camera frames'));
    } catch (e) {
      showToast(t(e instanceof Error ? e.message : 'Mock pair failed'));
    }
  };

  const openImuPicker = () => {
    setImuPickerOpen(true);
    showToast(t('Select IMU slots · UI mock (no BLE)'));
  };

  const imuCount = connectedImus.length;
  const imuSummary =
    imuCount === 0
      ? t('IMUs optional')
      : imuCount === 1
        ? t('{n} IMU connected', { n: imuCount })
        : t('{n} IMUs connected', { n: imuCount });

  return (
    <section
      className="screen active"
      data-screen="2"
      data-testid="screen-pair"
    >
      <div className="content pair-page">
        <div className="pair-head">
          <div>
            <h1>{t('Pair cameras')}</h1>
            <p className="sub" style={{ margin: 0 }}>
              {t(
                'Scan a QR with each phone. MotusCap Lite pairs 1 to 3 cameras. IMUs are optional.',
              )}
            </p>
          </div>
          {backend ? (
            <p
              className="sub"
              style={{ margin: 0, fontSize: 12, textAlign: 'right' }}
              data-testid="backend-info"
            >
              {t('Phone PWA · {protocol} · {host}', {
                protocol: backend.https ? 'HTTPS' : 'HTTP',
                host: `${backend.lanHost}:${backend.port}`,
              })}
            </p>
          ) : (
            <p className="sub" style={{ margin: 0, fontSize: 12 }}>
              {backendReady ? t('Backend ready') : t('Starting local backend…')}
            </p>
          )}
        </div>
        <div className="pair-cols">
          <div className={`card pcol${maxed ? ' maxed' : ''}`} id="pairCard">
            <div className="block-title">
              {qrActive
                ? t(
                    replacing
                      ? 'Scan to re-pair Cam {n}'
                      : 'Scan to pair Cam {n}',
                    { n: qrSlot + 1 },
                  )
                : t('Camera connection')}
            </div>
            <div className="pcol-scroll">
              <div className="pcol-fill">
                <div className="pcol-body">
                  {qrActive && activePairing ? (
                    <div className="qr-wrap">
                      <div className="qr-box" data-testid="qr-box">
                        {qrDataUrl ? (
                          <img src={qrDataUrl} alt={t('Pairing QR')} />
                        ) : (
                          <span className="qr-pending" data-testid="qr-pending">
                            {qrDrawError ?? t('Generating QR…')}
                          </span>
                        )}
                      </div>
                      <div className="code" data-testid="pairing-code">
                        {activePairing.code}
                      </div>
                      <span
                        className={`badge qr-via ${activeVia === 'public' ? 'warn' : 'ok'}`}
                        data-testid="qr-via-active"
                        data-via={activeVia ?? ''}
                      >
                        {activeVia === 'public'
                          ? t('Via public URL · {host}', {
                              host: hostOf(activePairing.qrUrl),
                            })
                          : t('Via local network · {host}', {
                              host: hostOf(activePairing.qrUrl),
                            })}
                      </span>
                      <p
                        className="sub pairing-url"
                        data-testid="pairing-url"
                        style={{
                          margin: '6px 0 0',
                          fontSize: 12,
                          textAlign: 'center',
                          wordBreak: 'break-all',
                        }}
                      >
                        {activePairing.qrUrl}
                      </p>
                      <p
                        className="sub"
                        style={{
                          margin: '6px 0 0',
                          fontSize: 12,
                          textAlign: 'center',
                        }}
                      >
                        {replacing
                          ? t(
                              'The current Cam {n} phone stays connected until the new phone completes pairing. ',
                              { n: qrSlot + 1 },
                            )
                          : ''}
                        {activeVia === 'public'
                          ? t(
                              'Scan with the phone. If ngrok shows a warning page, tap Visit Site. Then show cameras, choose one, and complete pairing. If the phone says the server cannot be found, its network blocks this address: Cancel QR and switch to Local network.',
                            )
                          : t(
                              'Scan with the phone on the same network. Tap Open secure camera page and continue past the certificate warning, then choose a camera and complete pairing.',
                            )}
                      </p>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        style={{ marginTop: 8 }}
                        onClick={() => void cancelPairing()}
                      >
                        {t('Cancel QR')}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        style={{ marginTop: 8 }}
                        onClick={() => void simulateScan()}
                        data-testid="pair-simulate"
                      >
                        {t('Simulate phone (no camera)')}
                      </button>
                    </div>
                  ) : (
                    <div className="paired-state" style={{ display: 'flex' }}>
                      <div className="paired-icon">✓</div>
                      <div>
                        <b>
                          {camCount
                            ? t('Cam {n} paired', { n: camCount })
                            : t('No camera paired yet')}
                        </b>
                        <span>
                          {maxed
                            ? t('All 3 camera slots are in use.')
                            : camCount
                              ? t('This QR code has been used.')
                              : t('Tap below to show a pairing QR code.')}
                        </span>
                      </div>
                    </div>
                  )}
                  <ol className="pair-steps">
                    <li>
                      {t(
                        'Open the phone browser and scan the QR (HTTPS required for camera)',
                      )}
                    </li>
                    <li>{t('Tap Complete pairing on the phone')}</li>
                    <li>
                      {t('Place the phone on a tripod facing the capture area')}
                    </li>
                    <li>
                      {t(
                        'Use Pair with next device for Cam 2 / Cam 3, Re-pair to swap in another phone, or Remove device to disconnect one',
                      )}
                    </li>
                  </ol>
                </div>
                {!qrActive && (
                  <div className="public-url" data-testid="public-url">
                    <span>{t('QR code address')}</span>
                    <div
                      className="speed-group qr-via-switch"
                      role="group"
                      aria-label={t('QR code address')}
                    >
                      {(
                        [
                          ['local', 'Local network'],
                          ['public', 'Public URL (ngrok)'],
                        ] as const
                      ).map(([via, text]) => (
                        <button
                          key={via}
                          type="button"
                          className={`speed-btn${qrVia === via ? ' on' : ''}`}
                          aria-pressed={qrVia === via}
                          data-testid={`qr-via-${via}`}
                          onClick={() => chooseQrVia(via)}
                        >
                          {t(text)}
                        </button>
                      ))}
                    </div>
                    {qrVia === 'local' ? (
                      <small data-testid="qr-via-summary">
                        {t(
                          'The QR uses {host}. The phone must be on the same Wi-Fi as this PC.',
                          { host: localHost || t('this PC') },
                        )}
                      </small>
                    ) : (
                      <>
                        <input
                          type="url"
                          value={publicUrl}
                          placeholder={t('https://example.ngrok-free.app')}
                          onChange={(e) => setPublicUrl(e.target.value)}
                          data-testid="public-url-input"
                        />
                        <small data-testid="qr-via-summary">
                          {t(
                            'The QR uses {host}. Use this when the phone cannot reach this PC, for example with a VPN on. Run ngrok http {port} and paste the https address. Some networks block ngrok addresses.',
                            {
                              host: publicUrl.trim()
                                ? hostOf(publicUrl.trim())
                                : '…',
                              port: pagePort || '<port>',
                            },
                          )}
                        </small>
                      </>
                    )}
                  </div>
                )}
                {!qrActive && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={maxed || !backend}
                    onClick={() => void pairNext()}
                    style={{ width: '100%', justifyContent: 'center' }}
                    data-testid="pair-next"
                  >
                    {camCount
                      ? t('＋ Pair with next device')
                      : t('＋ Pair a device')}
                  </button>
                )}
                <p
                  className="sub lite-limit"
                  style={{ margin: 0, fontSize: 12, textAlign: 'center' }}
                >
                  {maxed
                    ? t('Maximum of 3 cameras reached.')
                    : t('Up to 3 cameras. One is enough to start.')}
                </p>
              </div>
            </div>
          </div>

          <div className="card pcol">
            <div className="block-title">
              {t('Cameras')}{' '}
              <span
                className={`badge ${camCount ? 'ok' : 'warn'}`}
                style={{ marginLeft: 8 }}
              >
                {camCount ? (
                  <>
                    <span className="dot" />{' '}
                    {t('{n} of {max} connected', {
                      n: camCount,
                      max: CAM_MAX,
                    })}
                  </>
                ) : (
                  t('None connected')
                )}
              </span>
            </div>
            <div className="pcol-scroll">
              <div className="pcol-fill">
                <div className="cam-slots">
                  {CAM_PHONES.map((ph, i) => {
                    const device = devices[i];
                    const beingReplaced = replacing && qrSlot === i;
                    const st =
                      i < camCount && !beingReplaced
                        ? 'on'
                        : qrActive && i === qrSlot
                          ? 'wait'
                          : 'off';
                    const deviceName = device?.name ?? ph;
                    const label =
                      st === 'on'
                        ? t('{name} · Connected', { name: deviceName })
                        : beingReplaced
                          ? t(
                              'Waiting for new phone · {name} still connected',
                              { name: deviceName },
                            )
                          : st === 'wait'
                            ? t('Waiting for scan…')
                            : t('Not paired');
                    const roleName =
                      camCount === 1 || i >= 2
                        ? ''
                        : t(' · {role}', { role: t(VIEW_ROLES[i]) });
                    return (
                      <div
                        className={`slot ${st}`}
                        key={ph}
                        data-testid={`cam-slot-${i}`}
                      >
                        <div className="slot-feed">
                          {(st === 'on' || beingReplaced) && device ? (
                            <SlotPreview deviceId={device.deviceId} />
                          ) : null}
                        </div>
                        <div className="slot-info">
                          <b>{t('Cam {n}', { n: i + 1 })}</b>
                          {slotRole(camCount, i)}
                          <span>
                            <i className="sdot" />
                            {label}
                          </span>
                        </div>
                        {st === 'on' && !qrActive ? (
                          <div className="slot-actions">
                            <div
                              className="slot-action-box"
                              data-testid={`cam-repair-box-${i}`}
                            >
                              {confirmRepair === i ? (
                                <div
                                  className="slot-confirm"
                                  data-testid={`cam-repair-confirm-${i}`}
                                >
                                  <small>
                                    {t(
                                      'Replace Cam {n}{role}? The current phone is disconnected once the new phone pairs.',
                                      { n: i + 1, role: roleName },
                                    )}
                                  </small>
                                  <div>
                                    <button
                                      className="btn btn-primary btn-sm"
                                      type="button"
                                      onClick={() => void repair(i)}
                                      data-testid={`cam-repair-yes-${i}`}
                                    >
                                      {t('Show new QR')}
                                    </button>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      type="button"
                                      onClick={() => setConfirmRepair(null)}
                                    >
                                      {t('Cancel')}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    type="button"
                                    disabled={!backend}
                                    onClick={() => {
                                      setConfirmRemove(null);
                                      setConfirmRepair(i);
                                    }}
                                    data-testid={`cam-repair-${i}`}
                                  >
                                    {t('Re-pair')}
                                  </button>
                                  <small>{t('Swap in another phone')}</small>
                                </>
                              )}
                            </div>
                            <div
                              className="slot-action-box remove"
                              data-testid={`cam-remove-box-${i}`}
                            >
                              {confirmRemove === i ? (
                                <div
                                  className="slot-confirm"
                                  data-testid={`cam-remove-confirm-${i}`}
                                >
                                  <small>
                                    {t(
                                      'Remove Cam {n}{role}? This phone is disconnected and has to pair again to be used.',
                                      { n: i + 1, role: roleName },
                                    )}
                                  </small>
                                  <div>
                                    <button
                                      className="btn btn-red btn-sm"
                                      type="button"
                                      onClick={() => void removeCamera(i)}
                                      data-testid={`cam-remove-yes-${i}`}
                                    >
                                      {t('Remove device')}
                                    </button>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      type="button"
                                      onClick={() => setConfirmRemove(null)}
                                    >
                                      {t('Cancel')}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button
                                    className="btn btn-red btn-sm"
                                    type="button"
                                    disabled={!backend}
                                    onClick={() => {
                                      setConfirmRepair(null);
                                      setConfirmRemove(i);
                                    }}
                                    data-testid={`cam-remove-${i}`}
                                  >
                                    {t('Remove device')}
                                  </button>
                                  <small>{t('Disconnect this camera')}</small>
                                </>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <p className="sub" style={{ margin: 0, fontSize: 12 }}>
                  {camCount === 1
                    ? t(
                        'Place the single camera in front of the subject. With one camera, no view is assigned (saved files have no _F/_L/_O suffix). Pair a second camera to set Cam 1 as Frontal and Cam 2 as Lateral (right).',
                      )
                    : t(
                        "Place Cam 1 facing the subject and Cam 2 on the subject's right. Views are saved with every recording and file name. Cam 3 is an additional view with no fixed angle.",
                      )}
                </p>
              </div>
            </div>
          </div>

          <div className="card pcol" data-testid="pair-imu-col">
            <div className="block-title">
              {t('IMU sensors')}{' '}
              <span
                className={`badge${hasImus ? ' ok' : ''}`}
                style={
                  hasImus
                    ? { marginLeft: 8 }
                    : {
                        marginLeft: 8,
                        background: '#EEF1F6',
                        color: 'var(--muted)',
                      }
                }
                data-testid="pair-imu-badge"
              >
                {hasImus ? (
                  <>
                    <span className="dot" />{' '}
                    {t('{n} connected', { n: imuCount })}
                  </>
                ) : (
                  t('None connected · optional')
                )}
              </span>
            </div>
            <div className="pcol-scroll">
              <div className="pcol-fill">
                {imuPickerOpen ? (
                  <div
                    id="imuChips"
                    data-testid="imu-chips"
                    style={{ flex: '1 0 auto', alignContent: 'flex-start' }}
                  >
                    <p
                      className="sub"
                      style={{ margin: '0 0 8px', fontSize: 12, width: '100%' }}
                    >
                      {t(
                        'UI mock only — no BLE. Tap any subset (Femur L/R · Tibia L/R).',
                      )}
                    </p>
                    {IMU_SLOTS.map((slot) => {
                      const on = connectedImus.includes(slot.id);
                      return (
                        <button
                          type="button"
                          className={`chip${on ? '' : ' waiting'}`}
                          key={slot.id}
                          aria-pressed={on}
                          data-testid={`imu-chip-${slot.id}`}
                          onClick={() => toggleConnectedImu(slot.id)}
                        >
                          <span className="status" /> {t(slot.label)}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="imu-empty" data-testid="imu-empty">
                    <div className="imu-empty-icon">⌁</div>
                    <b>{t('No IMUs paired')}</b>
                    <span>
                      {t(
                        'MotusCap Lite runs with cameras only. Add IMUs for extra joint signals during Capture and Review.',
                      )}
                    </span>
                  </div>
                )}
                {!imuPickerOpen ? (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={openImuPicker}
                    style={{ width: '100%', justifyContent: 'center' }}
                    data-testid="imu-scan-connect"
                  >
                    {t('Scan & connect IMUs')}
                  </button>
                ) : (
                  <p
                    className="sub"
                    style={{ margin: 0, fontSize: 12, textAlign: 'center' }}
                  >
                    {t('Continue with cameras alone anytime · IMUs optional')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="pair-foot">
          <span className="pair-summary" data-testid="pair-summary">
            {camCount === 1
              ? t('{n} camera ready · {imu}', { n: camCount, imu: imuSummary })
              : t('{n} cameras ready · {imu}', {
                  n: camCount,
                  imu: imuSummary,
                })}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-ghost"
              type="button"
              data-testid="pair-home"
              onClick={() => {
                setFlow('home');
                go(0);
              }}
            >
              {t('Home')}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => go(1)}
            >
              {t('Back')}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={camCount < 1}
              onClick={() => go(4)}
              data-testid="pair-continue"
            >
              {t('Continue')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
