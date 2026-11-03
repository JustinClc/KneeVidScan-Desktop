import { useEffect, useState } from 'react';
import { listUsbCameras, type UsbCameraChoice } from '../lib/usbCamera';
import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';

export function UsbCameraPicker({ disabled }: { disabled: boolean }) {
  const { t } = useLocale();
  const { connectUsbCamera, usbHardwareIds } = useSession();
  const [cameras, setCameras] = useState<UsbCameraChoice[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanned, setScanned] = useState(false);
  const available = cameras.filter(
    (camera) => !usbHardwareIds.includes(camera.deviceId),
  );
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const found = await listUsbCameras();
      setCameras(found);
      setScanned(true);
      setSelected((current) =>
        found.some(
          (c) => c.deviceId === current && !usbHardwareIds.includes(c.deviceId),
        )
          ? current
          : (found.find((c) => !usbHardwareIds.includes(c.deviceId))
              ?.deviceId ?? ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media || !scanned) return;
    const changed = () => {
      void media
        .enumerateDevices()
        .then((found) => {
          const video = found
            .filter((d) => d.kind === 'videoinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label }));
          setCameras(video);
          setSelected((current) =>
            video.some((d) => d.deviceId === current) ? current : '',
          );
        })
        .catch(() => {});
    };
    media.addEventListener('devicechange', changed);
    return () => media.removeEventListener('devicechange', changed);
  }, [scanned]);
  const connect = async () => {
    const camera = available.find((c) => c.deviceId === selected);
    if (!camera) return;
    setBusy(true);
    setError('');
    try {
      await connectUsbCamera(camera.deviceId, camera.label);
      setSelected('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="usb-camera-picker" data-testid="usb-camera-picker">
      <b>{t('USB / computer cameras')}</b>
      <p>
        {t(
          'Connect a USB camera to this computer, then refresh the camera list. Built-in cameras are also available.',
        )}
      </p>
      <button
        className="btn btn-secondary"
        type="button"
        disabled={disabled || busy}
        onClick={() => void refresh()}
        data-testid="usb-camera-refresh"
      >
        {t(busy ? 'Please wait…' : 'Refresh cameras')}
      </button>
      {available.length > 0 && (
        <>
          <label htmlFor="usb-camera-select">{t('Select camera')}</label>
          <select
            id="usb-camera-select"
            value={selected}
            disabled={disabled || busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">{t('Select camera')}</option>
            {available.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            type="button"
            disabled={
              disabled ||
              busy ||
              !available.some((c) => c.deviceId === selected)
            }
            onClick={() => void connect()}
            data-testid="usb-camera-connect"
          >
            {t('Connect camera')}
          </button>
        </>
      )}
      {scanned && !available.length && (
        <p>
          {t(
            'No unconnected cameras found. Check the USB connection and camera permissions.',
          )}
        </p>
      )}
      {error && (
        <p role="alert">
          {t('Could not connect camera: {detail}', { detail: t(error) })}
        </p>
      )}
    </div>
  );
}
