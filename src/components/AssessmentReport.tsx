import type { QuestionnaireAnswers } from '../lib/questionnaire';
import type { Locale } from '../lib/locale';
import type { StandingCode } from '../lib/naming';
import { reportCopy } from '../lib/reportCopy';
import '../styles/report.css';

export type ReportPhotos = Partial<Record<StandingCode, string>>;
export type AssessmentReportProps = {
  locale: Locale;
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
  questionnaire: QuestionnaireAnswers;
  date: string;
  photos: ReportPhotos;
};

// Temporary analysis output. Keep separate from the subject's real data.
export const EXAMPLE_REPORT_METRICS = {
  risk: 17.5,
  mobility: 9,
  alignmentLeft: 0.52,
  alignmentRight: 6.64,
  extensionLeft: 5.25,
  extensionRight: 0.97,
} as const;

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
        {value}
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
    m = EXAMPLE_REPORT_METRICS;
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
        <p>{extension ? c.normalExtension : value > 4 ? c.varus : c.neutral}</p>
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
        <span className="report-example-badge">{c.example}</span>
      </header>
      <dl className="report-subject">
        {[
          [c.subject, subjectName || questionnaire.name || '—'],
          [c.id, subjectId],
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
      <p className="report-example-note">{c.exampleNote}</p>
      <div className="report-columns report-scores">
        <section className="report-card">
          <h2>{c.risk}</h2>
          <div className="report-score-content">
            <Gauge
              value={m.risk}
              stops={scoreStops(23, 55)}
              ticks={[0, 23, 55, 100]}
              label={c.risk}
            />
            <div className="report-score-copy">
              <strong>{c.low}</strong>
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
              <strong>{c.good}</strong>
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
          <p>{c.overallText}</p>
        </div>
        <div>
          <h2>{c.recommendations}</h2>
          <p>{c.recommendationText}</p>
        </div>
      </section>
      <aside className="report-disclaimer">
        <h2>{c.disclaimer}</h2>
        <p>{c.disclaimerText}</p>
      </aside>
    </article>
  );
}
