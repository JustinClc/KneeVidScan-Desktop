import { useRef, useState } from 'react';
import { backendClient } from '../lib/backendClient';
import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';

function isMp4(file: File): boolean {
  return file.name.toLowerCase().endsWith('.mp4');
}

function stemName(filename: string): string {
  const stem = filename.replace(/\.mp4$/i, '').trim();
  return stem || 'import01';
}

export function UploadMedia() {
  const {
    go,
    setFlow,
    subjectId,
    subjectName,
    setSubjectId,
    setSubjectName,
    setDevicesFromBackend,
    replaceTrials,
    clearUploadCapture,
    showToast,
  } = useSession();
  useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idOk = subjectId.trim().length > 0;

  const openPicker = () => {
    if (busy) return;
    fileRef.current?.click();
  };

  const beginUpload = async (file: File) => {
    setBusy(true);
    setReady(false);
    setProgress(0);
    setError(null);
    setFileName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const name = stemName(file.name);
      const result = await backendClient.importMedia({
        trialName: name,
        filename: file.name,
        bytes,
        fresh: true,
        onProgress: (fraction) => {
          setProgress(Math.round(Math.min(1, Math.max(0, fraction)) * 100));
        },
      });
      if (!result.trial_id) throw new Error('Import did not create a trial');
      setDevicesFromBackend(result.devices);
      replaceTrials({
        id: result.trial_id,
        name: result.name || name,
        startAtMs: null,
        durationSec: result.duration_sec ?? 0,
        stoppedAt: Date.now(),
      });
      setProgress(100);
      setReady(true);
      showToast(t('Uploaded {name}', { name: file.name }));
    } catch (err) {
      setReady(false);
      setFileName(null);
      setError(t(err instanceof Error ? err.message : 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  const takeFiles = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length || busy) return;
    if (picked.some((file) => !isMp4(file))) {
      setError(t('Only MP4 files can be imported.'));
      return;
    }
    if (picked.length !== 1) {
      setError(t('One MP4 file for v1.'));
      return;
    }
    const file = picked[0];
    if (!file) return;
    if (!subjectId.trim()) {
      setError(t('Enter a subject ID first.'));
      showToast(t('Enter a Subject ID first'));
      return;
    }
    void beginUpload(file);
  };

  const goHome = () => {
    clearUploadCapture();
    setFlow('home');
    go(0);
  };

  return (
    <section
      className="screen active"
      data-screen="9"
      data-testid="screen-upload-media"
    >
      <div className="upload-portal">
        <div className="upload-portal-inner">
          <h1>{t('Upload media')}</h1>
          <p className="sub">
            {t('Import an MP4 for pose analysis. One motion video for v1.')}
          </p>
          <div className="card upload-portal-card">
            <div className="row">
              <div>
                <label className="field" htmlFor="upload-subject-id">
                  {t('Subject ID')}{' '}
                  <span style={{ color: 'var(--red)' }}>*</span>
                </label>
                <input
                  id="upload-subject-id"
                  type="text"
                  data-testid="subject-id"
                  placeholder="e.g. UG0001"
                  value={subjectId}
                  required
                  onChange={(e) => setSubjectId(e.target.value)}
                  style={{ borderColor: idOk ? undefined : '#DC2626' }}
                />
                <small
                  data-testid="upload-subject-hint"
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: idOk ? 'var(--muted)' : '#DC2626',
                    marginTop: 4,
                  }}
                >
                  {idOk
                    ? t('Required. Used in export file names.')
                    : t('Enter a subject ID to continue.')}
                </small>
              </div>
              <div>
                <label className="field" htmlFor="upload-subject-name">
                  {t('Subject name')}{' '}
                  <span
                    style={{
                      fontWeight: 500,
                      textTransform: 'none',
                      letterSpacing: 0,
                    }}
                  >
                    {t('(optional)')}
                  </span>
                </label>
                <input
                  id="upload-subject-name"
                  type="text"
                  data-testid="subject-name"
                  placeholder="e.g. Chan Tai Man"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field">{t('Motion video')}</label>
              <div
                className={`upload-drop${dragOver ? ' dragover' : ''}${busy ? ' is-busy' : ''}`}
                data-testid="upload-drop"
                role="button"
                tabIndex={0}
                onClick={openPicker}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPicker();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  takeFiles(e.dataTransfer.files);
                }}
              >
                <div className="drop-icon" aria-hidden="true">
                  ⬆
                </div>
                <b>{t('Drag & drop an MP4 here')}</b>
                <span>{t('or')}</span>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="upload-file-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPicker();
                    }}
                  >
                    {t('Upload file')}
                  </button>
                </div>
                <div className="drop-hint">
                  {t('MP4 only · one motion video for v1')}
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".mp4,video/mp4"
                hidden
                data-testid="upload-file-input"
                onChange={(e) => {
                  takeFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              {busy ? (
                <div className="upload-progress" data-testid="upload-progress">
                  <div className="upload-progress-bar">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <div className="upload-progress-meta">
                    <span>
                      {progress >= 100 ? t('Upload complete') : t('Uploading…')}
                    </span>
                    <span data-testid="upload-progress-pct">{progress}%</span>
                  </div>
                </div>
              ) : null}
              {ready && fileName ? (
                <div className="upload-file-row" data-testid="upload-file-row">
                  <span className="ok">✓</span>
                  <span className="fname">{fileName}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {t('Ready')}
                  </span>
                </div>
              ) : null}
              {error ? (
                <p className="upload-error" data-testid="upload-error">
                  {t(error)}
                </p>
              ) : null}
            </div>
            <div className="actions" style={{ margin: 0 }}>
              <button
                className="btn btn-ghost"
                type="button"
                data-testid="upload-home"
                onClick={goHome}
              >
                {t('Home')}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                data-testid="upload-proceed"
                disabled={!idOk || !ready || busy}
                onClick={() => go(6)}
              >
                {t('Proceed')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
