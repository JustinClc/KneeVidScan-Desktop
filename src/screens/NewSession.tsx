import { CameraPairingButton } from '../components/CameraPairingButton';
import { useRef, useState, type FormEvent } from 'react';
import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import {
  choiceQuestions,
  isMeasurementInput,
  isQuestionnaireValid,
  type ChoiceKey,
  type QuestionnaireAnswers,
} from '../lib/questionnaire';
import { useSession } from '../state/SessionContext';

export function NewSession() {
  const {
    questionnaire: answers,
    setQuestionnaire,
    setQuestionnaireCompleted,
    setSubjectFolder,
    resetStanding,
    setSubjectId,
    setSubjectName,
    setHeightCm,
    setWeightKg,
    setSessionName,
    go,
    setFlow,
  } = useSession();
  const { locale } = useLocale();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submitting = useRef(false);
  const update = (key: keyof QuestionnaireAnswers, value: string) =>
    setQuestionnaire({ ...answers, [key]: value });
  const required = (
    <span className="questionnaire-required" aria-hidden="true">
      *
    </span>
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isQuestionnaireValid(answers) || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const save = window.motuscapLite?.saveQuestionnaire;
      if (!save)
        throw new Error(
          t('Questionnaire saving is unavailable. Open the desktop app.'),
        );
      const result = await save(
        answers,
        t('Choose the parent folder'),
        t('Choose'),
      );
      if (!result.ok) {
        if (!result.cancelled) setSaveError(result.error);
        return;
      }
      const id = answers.name.trim();
      setSubjectId(id);
      resetStanding();
      setSubjectName('');
      setSubjectFolder(id, result.folder);
      setSessionName(id);
      setHeightCm(String(Math.round(Number(answers.height) * 10000) / 100));
      setWeightKg(answers.weight);
      setQuestionnaireCompleted(true);
      go(4);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const textQuestion = (
    key: 'name' | 'phone' | 'age' | 'height' | 'weight',
    label: string,
    placeholder: string,
  ) => {
    const measurement = key === 'height' || key === 'weight';
    return (
      <div className="questionnaire-question" key={key}>
        <label htmlFor={`question-${key}`}>
          {key !== 'phone' && required}
          {t(label)}
        </label>
        <input
          id={`question-${key}`}
          name={key}
          aria-label={t(label)}
          type={key === 'phone' ? 'tel' : 'text'}
          required={key !== 'phone'}
          value={answers[key]}
          placeholder={t(placeholder)}
          inputMode={
            measurement ? 'decimal' : key === 'age' ? 'numeric' : undefined
          }
          pattern={
            measurement
              ? '[0-9]*[.]?[0-9]*'
              : key === 'age'
                ? '[0-9]+'
                : undefined
          }
          onChange={(e) => {
            const value = e.target.value;
            if (measurement && !isMeasurementInput(value)) return;
            if (key === 'age' && !/^\d*$/.test(value)) return;
            update(key, value);
          }}
        />
        {(measurement || key === 'age') && (
          <span className="questionnaire-range">{placeholder}</span>
        )}
      </div>
    );
  };
  const choices = (key: ChoiceKey) => {
    const question = choiceQuestions.find((q) => q.key === key)!;
    const label = (option: string) => {
      if (locale !== 'en' && key === 'smoking')
        return option === 'Yes' ? '有' : locale === 'zh-Hans' ? '无' : '無';
      if (locale !== 'en' && key === 'diabetes')
        return option === 'Yes' ? '有' : locale === 'zh-Hans' ? '没有' : '沒有';
      return t(option);
    };
    return (
      <fieldset className="questionnaire-question" key={key}>
        <legend>
          {required}
          {t(question.label)}
        </legend>
        <div
          className={`questionnaire-options ${key === 'activity' ? 'questionnaire-options-stacked' : ''}`}
        >
          {question.options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={key}
                value={option}
                checked={answers[key] === option}
                required
                onChange={() => update(key, option)}
              />
              <span>{label(option)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  };
  return (
    <section
      className="screen active"
      data-screen="1"
      data-testid="screen-session"
    >
      <div className="content">
        <form
          className="questionnaire card"
          onSubmit={(event) => void submit(event)}
        >
          <fieldset
            disabled={saving}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className="questionnaire-heading">
              <h1>{t('Health questionnaire')}</h1>
              <CameraPairingButton testId="questionnaire-pair-cameras" />
            </div>
            <p className="sub">{t('Fields marked * are required.')}</p>
            <h2>{t('Personal information')}</h2>
            {textQuestion('name', 'Name/SID', 'Please enter')}
            {textQuestion('phone', 'Tel.', 'Please enter')}
            <h2>{t('Health questionnaire')}</h2>
            {textQuestion('age', 'Age', '18-120')}
            {choices('sex')}
            {textQuestion('height', 'Height (m)', '0.8-2.3')}
            {textQuestion('weight', 'Weight (kg)', '20-200')}
            {choiceQuestions
              .filter((q) => q.key !== 'sex')
              .map((q) => choices(q.key))}
            {saveError && <p role="alert">{saveError}</p>}
            <div className="actions questionnaire-actions">
              <button
                className="btn btn-ghost"
                type="button"
                data-testid="session-home"
                onClick={() => {
                  setFlow('home');
                  go(0);
                }}
              >
                {t('Back')}
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                data-testid="questionnaire-submit"
                disabled={saving || !isQuestionnaireValid(answers)}
              >
                {saving ? t('Saving…') : t('Submit')}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </section>
  );
}
