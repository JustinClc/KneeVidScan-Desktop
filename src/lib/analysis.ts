import type { QuestionnaireAnswers } from './questionnaire';
import type { Locale } from './locale';
import type { StandingCode } from './naming';

export type AnalysisInput = {
  folder: string;
  subjectId: string;
  subjectName: string;
  questionnaire: QuestionnaireAnswers;
  locale: Locale;
  videos: string[]; // Paths relative to the subject folder.
};
export type AnalysisResult = {
  version: string;
  risk: number;
  mobility: number;
  alignmentLeft: number;
  alignmentRight: number;
  extensionLeft: number;
  extensionRight: number;
  riskText: string;
  advice: string[];
  videoMeasurements: Record<string, number | boolean>;
  featureImportance: Record<string, number>;
};
export type AnalysisResponse =
  | { ok: true; result: AnalysisResult }
  | {
      ok: false;
      code: 'questionnaire' | 'image' | 'pose' | 'video' | 'runtime';
      step: 1 | 4 | 5 | 6 | 7;
      field?: string | StandingCode;
    };

/** Validate the process boundary before allowing results into a report or cache. */
export function isAnalysisResponse(value: unknown): value is AnalysisResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (r.ok === false)
    return (
      ['questionnaire', 'image', 'pose', 'video', 'runtime'].includes(
        String(r.code),
      ) &&
      [1, 4, 5, 6, 7].includes(Number(r.step)) &&
      (r.field == null || typeof r.field === 'string')
    );
  if (r.ok !== true || !r.result || typeof r.result !== 'object') return false;
  const m = r.result as Record<string, unknown>;
  return (
    [
      'risk',
      'mobility',
      'alignmentLeft',
      'alignmentRight',
      'extensionLeft',
      'extensionRight',
    ].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k])) &&
    Number(m.risk) >= 0 &&
    Number(m.risk) <= 100 &&
    Number(m.mobility) >= 0 &&
    Number(m.mobility) <= 100 &&
    typeof m.version === 'string' &&
    typeof m.riskText === 'string' &&
    Array.isArray(m.advice) &&
    m.advice.every((a) => typeof a === 'string') &&
    !!m.videoMeasurements &&
    typeof m.videoMeasurements === 'object' &&
    !!m.featureImportance &&
    typeof m.featureImportance === 'object'
  );
}

export function analysisCopy(locale: Locale) {
  if (locale === 'zh-Hant')
    return {
      running: '正在本機分析評估資料…',
      retry: '重新分析',
      fix: '返回修正',
      questionnaire: '請修正健康問卷的資料後重新提交。',
      image: '無法讀取站立照片。請返回重拍指定角度。',
      pose: '未能辨識髖、膝及足踝。請保持全身清晰入鏡並重拍指定角度。',
      video: '錄影缺失或無法讀取。請返回檢查或重新錄影。',
      runtime: '無法啟動本機分析。請檢查分析元件是否完整安裝，然後重試。',
    };
  if (locale === 'zh-Hans')
    return {
      running: '正在本机分析评估资料…',
      retry: '重新分析',
      fix: '返回修正',
      questionnaire: '请修正健康问卷的资料后重新提交。',
      image: '无法读取站立照片。请返回重拍指定角度。',
      pose: '未能识别髋、膝及脚踝。请保持全身清晰入镜并重拍指定角度。',
      video: '录像缺失或无法读取。请返回检查或重新录像。',
      runtime: '无法启动本机分析。请检查分析组件是否完整安装，然后重试。',
    };
  return {
    running: 'Analyzing assessment locally…',
    retry: 'Retry analysis',
    fix: 'Return to correct input',
    questionnaire:
      'Correct the indicated health questionnaire input and submit again.',
    image: 'The standing photo could not be read. Retake the indicated view.',
    pose: 'Hip, knee and ankle landmarks could not be detected. Retake the indicated view with the full body clearly visible.',
    video:
      'The recording is missing or unreadable. Review it or record it again.',
    runtime:
      'Local analysis could not start. Check that the analysis components are installed, then retry.',
  };
}
