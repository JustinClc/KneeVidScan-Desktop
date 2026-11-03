import { renderToStaticMarkup } from 'react-dom/server';
import {
  AssessmentReport,
  type AssessmentReportProps,
} from '../components/AssessmentReport';
import css from '../styles/report.css?raw';
import { reportCopy } from './reportCopy';

export function buildReportDocument(props: AssessmentReportProps): string {
  const lang =
    props.locale === 'zh-Hant'
      ? 'zh-HK'
      : props.locale === 'zh-Hans'
        ? 'zh-CN'
        : 'en';
  // React escapes every subject field; only embedded PNGs are supplied as photos.
  return (
    '<!DOCTYPE html>' +
    renderToStaticMarkup(
      <html lang={lang}>
        <head>
          <meta charSet="utf-8" />
          <title>{reportCopy(props.locale).title}</title>
          <style>{css}</style>
        </head>
        <body>
          <AssessmentReport {...props} />
        </body>
      </html>,
    )
  );
}
