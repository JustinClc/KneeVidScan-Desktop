import {
  analysisCopy,
  type AnalysisResponse,
  type AnalysisResult,
} from '../lib/analysis';
import { useEffect, useRef, useState } from 'react';
import {
  AssessmentReport,
  type ReportPhotos,
} from '../components/AssessmentReport';
import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';
import {
  STANDING_SEQUENCE,
  standingFileName,
  subjectBase,
  trialFolderSlug,
  recordingVideoFileName,
} from '../lib/naming';
import { reportCopy } from '../lib/reportCopy';

export function FinalReport() {
  const { locale } = useLocale();
  const {
    go,
    resetSession,
    showToast,
    subjectId,
    subjectName,
    heightCm,
    weightKg,
    questionnaire,
    subjectFolderById,
    sessionEpoch,
    trialRecords,
    trialName,
    camCount,
    setAnalysisRecovery,
  } = useSession();
  const c = reportCopy(locale);
  const ac = analysisCopy(locale);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisFailure, setAnalysisFailure] = useState<Extract<
    AnalysisResponse,
    { ok: false }
  > | null>(null);
  const [analyzing, setAnalyzing] = useState(true);
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const folder = subjectFolderById[subjectId];
  const [photos, setPhotos] = useState<ReportPhotos>({});
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const [assessmentDate] = useState(
    () => new Date(trialRecords[0]?.startAtMs ?? Date.now()),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPhotos({});
    void Promise.all(
      STANDING_SEQUENCE.map(async (code) => {
        // Only the explicitly annotated files may appear in reports. Never fall
        // back to a clean original or to a legacy unannotated crop.
        const bytes = folder
          ? await window.motuscapLite
              ?.readSaveFile(
                folder,
                standingFileName(subjectId, subjectName, code),
              )
              .catch(() => null)
          : null;
        return [
          code,
          bytes ? `data:image/png;base64,${bytes}` : undefined,
        ] as const;
      }),
    ).then((items) => {
      if (!active) return;
      setPhotos(Object.fromEntries(items));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [folder, subjectId, subjectName, reload]);

  useEffect(() => {
    let active = true;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisFailure(null);
    setSavedPath('');
    const trial =
      [...trialRecords].reverse().find((t) => t.name === trialName) ??
      trialRecords.at(-1);
    const videos = trial
      ? Array.from(
          { length: camCount },
          (_, index) =>
            `${trialFolderSlug(trial.name)}/${recordingVideoFileName(subjectId, subjectName, trial.name, camCount, index)}`,
        )
      : [];
    const run = window.motuscapLite?.analyzeAssessment;
    const request =
      run && folder
        ? run({ folder, subjectId, subjectName, questionnaire, locale, videos })
        : Promise.resolve({ ok: false, code: 'runtime', step: 7 } as const);
    void request
      .catch(() => ({ ok: false, code: 'runtime', step: 7 }) as const)
      .then((response) => {
        if (!active) return;
        if (response.ok) {
          setAnalysis(response.result);
          setAnalysisRecovery(null);
        } else setAnalysisFailure(response);
        setAnalyzing(false);
      });
    return () => {
      active = false;
    };
  }, [
    folder,
    subjectId,
    subjectName,
    questionnaire,
    locale,
    trialRecords,
    trialName,
    camCount,
    analysisRetry,
  ]);

  const props = {
    locale,
    analysis: analysis!,
    subjectId,
    subjectName,
    heightCm,
    weightKg,
    questionnaire,
    photos,
    date: assessmentDate.toLocaleDateString(
      locale === 'en' ? 'en-GB' : locale === 'zh-Hant' ? 'zh-HK' : 'zh-CN',
    ),
  };
  const exportPdf = async () => {
    if (busy.current || !analysis || analyzing || analysisFailure) return;
    if (!folder) {
      setError(c.missingFolder);
      return;
    }
    const exportReport = window.motuscapLite?.exportReport;
    if (!exportReport) {
      setError(c.unavailable);
      return;
    }
    busy.current = true;
    setExporting(true);
    setError('');
    const epoch = sessionEpoch.current;
    try {
      const filename = `${Array.from(subjectBase(subjectId, subjectName))
        .filter((c) => c.charCodeAt(0) >= 32)
        .join('')
        .replace(
          /[<>:"/\\|?*]/g,
          '-',
        )}_report_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
      const { buildReportDocument } = await import('../lib/reportDocument');
      const result = await exportReport({
        folder,
        filename,
        html: buildReportDocument(props),
      });
      if (epoch !== sessionEpoch.current) return;
      if (!result.ok) throw new Error(result.error);
      setSavedPath(result.path);
      showToast(`${c.saved} ${result.path}`, 10000);
      if (result.openError) setError(`${c.openError} ${result.openError}`);
    } catch (err) {
      if (epoch === sessionEpoch.current)
        setError(
          `${c.exportError} ${err instanceof Error ? err.message : String(err)}`,
        );
    } finally {
      busy.current = false;
      if (epoch === sessionEpoch.current) setExporting(false);
    }
  };
  const endAssessment = async () => {
    if (busy.current) return;
    busy.current = true;
    setEnding(true);
    try {
      await resetSession();
    } catch (err) {
      setError(String(err));
      setEnding(false);
    } finally {
      busy.current = false;
    }
  };
  return (
    <section
      className="screen active"
      data-screen="8"
      data-testid="screen-final-report"
    >
      <div className="report-screen-scroll">
        <div className="report-toolbar">
          <button
            className="btn btn-ghost"
            type="button"
            data-testid="report-back-pose"
            disabled={exporting || ending}
            onClick={() => go(7)}
          >
            {c.back}
          </button>
          {loading ? (
            <span className="report-load-status">{c.load}</span>
          ) : STANDING_SEQUENCE.some((code) => !photos[code]) ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={exporting || ending}
              onClick={() => setReload((n) => n + 1)}
            >
              {c.retry}
            </button>
          ) : null}
        </div>
        {analyzing ? (
          <p role="status">{ac.running}</p>
        ) : analysisFailure ? (
          <div
            role="alert"
            className="report-saved-path"
            data-testid="analysis-failure"
          >
            <p>
              {ac[analysisFailure.code]} {analysisFailure.field ?? ''}
            </p>
            {analysisFailure.code !== 'runtime' && (
              <button
                className="btn btn-primary"
                type="button"
                data-testid="analysis-correct"
                onClick={() => {
                  setAnalysisRecovery(analysisFailure);
                  go(analysisFailure.step);
                }}
              >
                {ac.fix}
              </button>
            )}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setAnalysisRetry((n) => n + 1)}
            >
              {ac.retry}
            </button>
          </div>
        ) : analysis ? (
          <AssessmentReport {...props} />
        ) : null}
        {savedPath ? (
          <p
            className="report-saved-path"
            role="status"
            data-testid="report-saved-path"
          >
            {c.saved} {savedPath}
          </p>
        ) : null}
        {error ? (
          <p className="report-saved-path" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="report-actions">
        <small>{c.exportHelp}</small>
        <button
          className="btn btn-primary"
          type="button"
          data-testid="report-export"
          disabled={
            loading ||
            analyzing ||
            !analysis ||
            !!analysisFailure ||
            exporting ||
            ending
          }
          onClick={() => void exportPdf()}
        >
          {exporting ? c.exporting : c.export}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          data-testid="report-end-assessment"
          disabled={exporting || ending}
          onClick={() => void endAssessment()}
        >
          {ending ? c.ending : c.end}
        </button>
      </footer>
    </section>
  );
}
