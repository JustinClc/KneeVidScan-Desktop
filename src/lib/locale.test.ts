import { afterEach, describe, expect, it } from 'vitest';
import { zhHans, zhHant } from './messages';
import {
  getLocale,
  parseLocale,
  resetLocaleForTests,
  setLocale,
  t,
} from './locale';

describe('Locale', () => {
  afterEach(() => {
    resetLocaleForTests();
  });

  it('starts in English and ignores the browser language', () => {
    expect(parseLocale(null)).toBe('en');
    expect(parseLocale('zh-HK')).toBe('en');
    expect(parseLocale('zh-Hant')).toBe('zh-Hant');
    expect(parseLocale('zh-Hans')).toBe('zh-Hans');
    expect(getLocale()).toBe('en');
  });

  it('remembers the choice on this device', () => {
    setLocale('zh-Hant');
    expect(localStorage.getItem('motuscap-lite.locale')).toBe('zh-Hant');
    expect(getLocale()).toBe('zh-Hant');
    expect(t('Start recording')).toBe('開始錄製');
  });

  it('uses Hong Kong wording and Mainland wording', () => {
    setLocale('zh-Hant');
    expect(t('Upload media')).toBe('上載影片');
    expect(t('Scan with the phone on the same network.')).toContain('網絡');
    setLocale('zh-Hans');
    expect(t('Upload media')).toBe('上传视频');
    expect(t('Scan with the phone on the same network.')).toContain('网络');
    expect(t('MotusCap Lite')).toBe('MotusCap Lite');
  });

  it('falls back to English when a sentence has no translation', () => {
    setLocale('zh-Hans');
    expect(t('This sentence is not translated yet')).toBe(
      'This sentence is not translated yet',
    );
    expect(t('Cam {n}', { n: 2 })).toBe('相机 {n}'.replace('{n}', '2'));
  });

  it('keeps a translation for every Traditional Chinese sentence in Simplified Chinese', () => {
    const traditional = Object.keys(zhHant);
    const simplified = Object.keys(zhHans);
    expect(simplified.sort()).toEqual(traditional.sort());
    for (const key of traditional) {
      expect(zhHant[key].length).toBeGreaterThan(0);
      expect(zhHans[key].length).toBeGreaterThan(0);
    }
  });
});
