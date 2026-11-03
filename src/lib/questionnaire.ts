export const choiceQuestions = [
  { key: 'sex', label: 'Sex', options: ['Male', 'Female'] },
  { key: 'smoking', label: 'Smoking habit', options: ['Yes', 'No'] },
  {
    key: 'activity',
    label: 'Work activity level',
    options: [
      'Mostly sit',
      'Sit and stand/walk',
      'Mostly stand/walk',
      'Deal with loads of < 50 lbs',
      'Deal with loads of > 50 lbs',
    ],
  },
  { key: 'diabetes', label: 'Diabetes history', options: ['Yes', 'No'] },
  {
    key: 'injury',
    label: 'History of knee injury affecting mobility for more than 2 weeks',
    options: ['Yes', 'No'],
  },
  { key: 'surgery', label: 'History of knee surgery', options: ['Yes', 'No'] },
  {
    key: 'clicking',
    label: 'Persistent clicking sound in the knee',
    options: ['Yes', 'No'],
  },
  { key: 'walkingAid', label: 'Use of walking aid', options: ['Yes', 'No'] },
  {
    key: 'pain',
    label:
      'Degree of knee pain within the recent month (0: no pain, 10: the most painful)',
    options: Array.from({ length: 11 }, (_, i) => String(i)),
  },
] as const;
export type ChoiceKey = (typeof choiceQuestions)[number]['key'];
export type QuestionnaireAnswers = Record<
  ChoiceKey | 'name' | 'phone' | 'age' | 'height' | 'weight',
  string
>;
export function emptyQuestionnaire(): QuestionnaireAnswers {
  return {
    name: '',
    phone: '',
    age: '',
    height: '',
    weight: '',
    sex: '',
    smoking: '',
    activity: '',
    diabetes: '',
    injury: '',
    surgery: '',
    clicking: '',
    walkingAid: '',
    pain: '',
  };
}
/** Accept decimal measurements without allowing signs, exponents, or text. */
export function isMeasurementInput(value: string): boolean {
  return /^\d*(\.\d*)?$/.test(value);
}
export function isQuestionnaireValid(a: QuestionnaireAnswers): boolean {
  return (
    !!a.name.trim() &&
    /^\d+$/.test(a.age) &&
    Number(a.age) >= 18 &&
    Number(a.age) <= 120 &&
    [a.height, a.weight].every(
      (v) => isMeasurementInput(v) && v !== '' && Number.isFinite(Number(v)),
    ) &&
    Number(a.height) >= 0.8 &&
    Number(a.height) <= 2.3 &&
    Number(a.weight) >= 20 &&
    Number(a.weight) <= 200 &&
    choiceQuestions.every((q) =>
      (q.options as readonly string[]).includes(a[q.key]),
    )
  );
}
