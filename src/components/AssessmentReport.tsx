import type { AnalysisResult } from '../lib/analysis';
import type { QuestionnaireAnswers } from '../lib/questionnaire';
import type { Locale } from '../lib/locale';
import type { StandingCode } from '../lib/naming';
import { reportCopy } from '../lib/reportCopy';
import '../styles/report.css';

export type ReportPhotos = Partial<Record<StandingCode, string>>;
export type AssessmentReportProps = {
  analysis: AnalysisResult;
  locale: Locale;
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
  questionnaire: QuestionnaireAnswers;
  date: string;
  photos: ReportPhotos;
};

function Gauge({
  value,
  min = 0,
  max = 100,
  stops,
  ticks,
  unit = '',
  label,
  color = '#125d9e',
}: {
  value: number;
  min?: number;
  max?: number;
  stops: Array<[number, string]>;
  ticks: number[];
  unit?: string;
  label: string;
  color?: string;
}) {
  const point = (v: number, radius = 79) => {
    const a = Math.PI * (1 - (v - min) / (max - min));
    return [110 + radius * Math.cos(a), 103 - radius * Math.sin(a)];
  };
  const needle = point(value, 65);
  return (
    <svg
      className="report-gauge"
      viewBox="0 0 220 142"
      role="img"
      aria-label={`${label}: ${value}${unit}`}
    >
      {stops.slice(0, -1).map(([from, fill], i) => {
        const a = point(from),
          b = point(stops[i + 1][0]);
        return (
          <path
            key={from}
            d={`M ${a[0]} ${a[1]} A 79 79 0 0 1 ${b[0]} ${b[1]}`}
            fill="none"
            stroke={fill}
            strokeWidth="20"
          />
        );
      })}
      {ticks.map((v) => {
        const [x, y] = point(v, 101);
        return (
          <text
            key={v}
            x={x}
            y={y + 4}
            textAnchor="middle"
            className="report-tick"
          >
            {v}
          </text>
        );
      })}
      <line
        x1="110"
        y1="103"
        x2={needle[0]}
        y2={needle[1]}
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="110" cy="103" r="4" fill={color} />
      <rect
        x="64"
        y="111"
        width="92"
        height="26"
        fill="var(--report-panel)"
        rx="5"
      />
      <text
        x="110"
        y="131"
        textAnchor="middle"
        fontSize="22"
        fontWeight="750"
        fill={color}
      >
        {Math.round(value * 100) / 100}
        {unit}
      </text>
    </svg>
  );
}

export function AssessmentReport(props: AssessmentReportProps) {
  const {
    locale,
    subjectId,
    subjectName,
    questionnaire,
    date,
    photos,
    heightCm,
    weightKg,
  } = props;
  const c = reportCopy(locale),
    m = props.analysis;
  const scoreStops = (a: number, b: number): Array<[number, string]> => [
    [0, '#125d9e'],
    [a, '#ffbd2c'],
    [b, '#ee292e'],
    [100, '#ee292e'],
  ];
  const angleStops = (
    limit: number,
    neutral: number,
    caution: number,
  ): Array<[number, string]> => [
    [-limit, '#ee292e'],
    [-caution, '#ffbd2c'],
    [-neutral, '#00b665'],
    [neutral, '#ffbd2c'],
    [caution, '#ee292e'],
    [limit, '#ee292e'],
  ];
  const photo = (code: StandingCode, label: string) =>
    photos[code] ? (
      <img src={photos[code]} alt={label} className="report-posture" />
    ) : (
      <div className="report-photo-missing">{c.missingPhoto}</div>
    );
  const leg = (
    key: string,
    code: StandingCode,
    name: string,
    value: number,
    extension: boolean,
  ) => (
    <div className="report-leg" key={key} data-testid={`report-${key}`}>
      {photo(
        code,
        code === 'F' ? c.frontal : code === 'LL' ? c.leftView : c.rightView,
      )}
      <div className="report-leg-result">
        <h3>{name}</h3>
        <Gauge
          value={value}
          min={extension ? -40 : -30}
          max={extension ? 40 : 30}
          stops={angleStops(
            extension ? 40 : 30,
            extension ? 6.5 : 4,
            extension ? 15 : 8.5,
          )}
          ticks={
            extension
              ? [-40, -15, -6.5, 0, 6.5, 15, 40]
              : [-30, -8.5, -4, 0, 4, 8.5, 30]
          }
          unit="°"
          label={`${name} · ${extension ? c.extension : c.alignment}`}
          color={!extension && value > 4 ? '#ae6c00' : '#008548'}
        />
        <p>{angleInterpretation(locale, value, extension)}</p>
      </div>
    </div>
  );
  const sex =
    questionnaire.sex === 'Male'
      ? locale === 'en'
        ? 'Male'
        : '男'
      : questionnaire.sex === 'Female'
        ? locale === 'en'
          ? 'Female'
          : '女'
        : '—';
  return (
    <article className="assessment-report" data-testid="assessment-report">
      <header className="report-header">
        <div>
          <p className="report-eyebrow">
            KneeVidScan <span> / {c.subtitle}</span>
          </p>
          <h1>{c.title}</h1>
        </div>
      </header>
      <dl className="report-subject">
        {[
          [
            c.nameId,
            subjectName.trim() ||
              questionnaire.name.trim() ||
              subjectId.trim() ||
              '—',
          ],
          [c.date, date],
          [c.age, questionnaire.age || '—'],
          [c.sex, sex],
          [c.height, `${heightCm || '—'} cm`],
          [c.weight, `${weightKg || '—'} kg`],
        ].map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="report-columns report-scores">
        <section className="report-card">
          <h2>{c.risk}</h2>
          <div className="report-score-content">
            <Gauge
              value={m.risk}
              stops={scoreStops(23, 60)}
              ticks={[0, 23, 60, 100]}
              label={c.risk}
            />
            <div className="report-score-copy">
              <strong>
                {m.risk < 23 ? c.low : m.risk < 60 ? c.moderate : c.high}
              </strong>
              <p>{c.riskLow}</p>
              <p>{c.riskMid}</p>
              <p>{c.riskHigh}</p>
            </div>
          </div>
        </section>
        <section className="report-card">
          <h2>{c.mobility}</h2>
          <div className="report-score-content">
            <Gauge
              value={m.mobility}
              stops={scoreStops(30, 60)}
              ticks={[0, 30, 60, 100]}
              label={c.mobility}
            />
            <div className="report-score-copy">
              <strong>
                {m.mobility < 30
                  ? c.good
                  : m.mobility < 60
                    ? c.acceptable
                    : c.improve}
              </strong>
              <p>{c.mobilityLow}</p>
              <p>{c.mobilityMid}</p>
              <p>{c.mobilityHigh}</p>
            </div>
          </div>
        </section>
      </div>
      <p className="report-posture-note">{c.postureNote}</p>
      <div className="report-columns report-posture-columns">
        <section className="report-card">
          <h2>{c.alignment}</h2>
          {leg('alignment-left', 'F', c.left, m.alignmentLeft, false)}
          {leg('alignment-right', 'F', c.right, m.alignmentRight, false)}
        </section>
        <section className="report-card">
          <h2>{c.extension}</h2>
          {leg('extension-left', 'LL', c.left, m.extensionLeft, true)}
          {leg('extension-right', 'RL', c.right, m.extensionRight, true)}
        </section>
      </div>
      <section className="report-evaluation">
        <div>
          <h2>{c.overall}</h2>
          <p className="report-overall-content">
            {m.riskText
              .split(
                /(\b(?:Low|Medium|Moderate|High) risk\b|[低中高]風險|[低中高]风险)/gi,
              )
              .map((part, index) => {
                const level = /^(low risk|低風險|低风险)$/i.test(part)
                  ? 'low'
                  : /^(medium risk|moderate risk|中風險|中风险)$/i.test(part)
                    ? 'medium'
                    : /^(high risk|高風險|高风险)$/i.test(part)
                      ? 'high'
                      : null;
                return level ? (
                  <strong key={index} className={`report-risk-${level}`}>
                    {part}
                  </strong>
                ) : (
                  part
                );
              })}
          </p>
        </div>
        <div>
          <h2>{c.recommendations}</h2>
          <ul>
            {m.advice.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      </section>
      <aside className="report-disclaimer">
        <h2>{c.disclaimer}</h2>
        <p>{c.disclaimerText}</p>
      </aside>
    </article>
  );
}

function angleInterpretation(
  locale: Locale,
  value: number,
  extension: boolean,
): string {
  const labels =
    locale === 'en'
      ? [
          'Neutral alignment',
          'Varus alignment',
          'Valgus alignment',
          'Normal knee extension',
          'Flexion contracture',
          'Hyperextension',
        ]
      : locale === 'zh-Hant'
        ? [
            '正常力線',
            '膝內翻',
            '膝外翻',
            '正常膝伸展',
            '屈曲攣縮',
            '膝過度伸展',
          ]
        : [
            '正常力线',
            '膝内翻',
            '膝外翻',
            '正常膝伸展',
            '屈曲挛缩',
            '膝过度伸展',
          ];
  return extension
    ? labels[value > 6.5 ? 4 : value < -6.5 ? 5 : 3]
    : labels[value >= 4 ? 1 : value <= -4 ? 2 : 0];
}
