// src/utils/settingsProfile.test.ts
// 「譜面設定の初期値プリセット」（issue #39）の純関数テスト。
// 正常系・欠損キー・不正JSON・バージョン不一致のフォールバックを確認する。

import { describe, expect, it, beforeEach } from 'vitest';
import {
  SETTINGS_PROFILE_STORAGE_KEY,
  SETTINGS_PROFILE_VERSION,
  getFactoryDefaultSettingsProfile,
  parseSettingsProfile,
  loadSettingsProfile,
  saveSettingsProfile,
  resetSettingsProfile,
  hasSettingsProfile,
  type ScoreSettingsProfile,
} from './settingsProfile';

// localStorage のシンプルなインメモリ実装（他の *.test.ts と同じ最小限のモック）
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// saveSettingsProfile は version を受け取らない（呼び出し側が指定できないようにするため）。
// テスト用の完全な ScoreSettingsProfile から version だけ取り除くヘルパー。
function withoutVersion(profile: ScoreSettingsProfile): Omit<ScoreSettingsProfile, 'version'> {
  const { version, ...rest } = profile;
  void version;
  return rest;
}

const VALID_PROFILE: ScoreSettingsProfile = {
  version: SETTINGS_PROFILE_VERSION,
  scoreType: 'ensemble',
  instrumentationPresetId: 'wind-band',
  timeSignature: [3, 4],
  keySignature: 'G',
  measuresPerSystem: 6,
  systemsPerPageSetting: 5,
  displayWeight: 'thick',
  measureWidthEvenness: 0.75,
  notationSizeMultiplier: 1.2,
  pageMarginSideMm: 18,
  pageMarginTopMm: 20,
  pageMarginBottomMm: 16,
  systemRowGapPx: 10,
};

describe('settingsProfile', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('getFactoryDefaultSettingsProfile（Issue #49: 単旋律の既定は音符150%・段間隔0px）', () => {
    it('工場出荷既定値の scoreType は single で、音符サイズ150%・段間隔0pxになっている', () => {
      const fallback = getFactoryDefaultSettingsProfile();
      expect(fallback.scoreType).toBe('single');
      expect(fallback.notationSizeMultiplier).toBe(1.5);
      expect(fallback.systemRowGapPx).toBe(0);
    });
  });

  describe('parseSettingsProfile（純関数・フォールバック）', () => {
    it('正常: 妥当なプロファイルはそのまま復元される', () => {
      const parsed = parseSettingsProfile(JSON.stringify(VALID_PROFILE));
      expect(parsed).toEqual(VALID_PROFILE);
    });

    it('null（未保存）: 工場出荷既定値を返す', () => {
      expect(parseSettingsProfile(null)).toEqual(getFactoryDefaultSettingsProfile());
    });

    it('不正JSON: 工場出荷既定値を返す', () => {
      expect(parseSettingsProfile('{not valid json')).toEqual(getFactoryDefaultSettingsProfile());
    });

    it('バージョン不一致: 工場出荷既定値を返す', () => {
      const wrongVersion = JSON.stringify({ ...VALID_PROFILE, version: 999 });
      expect(parseSettingsProfile(wrongVersion)).toEqual(getFactoryDefaultSettingsProfile());
    });

    it('version フィールドが無いJSON: 工場出荷既定値を返す', () => {
      expect(parseSettingsProfile(JSON.stringify(withoutVersion(VALID_PROFILE)))).toEqual(getFactoryDefaultSettingsProfile());
    });

    it('欠損キー: 一部フィールドが無ければそのフィールドだけ既定値へフォールバックし、他は維持する', () => {
      const { measureWidthEvenness, ...partial } = VALID_PROFILE;
      void measureWidthEvenness;
      const parsed = parseSettingsProfile(JSON.stringify(partial));
      const fallback = getFactoryDefaultSettingsProfile();
      expect(parsed.measureWidthEvenness).toBe(fallback.measureWidthEvenness);
      expect(parsed.scoreType).toBe(VALID_PROFILE.scoreType);
      expect(parsed.systemRowGapPx).toBe(VALID_PROFILE.systemRowGapPx);
    });

    it('範囲外の値: 個別フィールドだけ既定値へフォールバックする（プロファイル全体は捨てない）', () => {
      const outOfRange = { ...VALID_PROFILE, notationSizeMultiplier: 999, systemRowGapPx: -999 };
      const parsed = parseSettingsProfile(JSON.stringify(outOfRange));
      const fallback = getFactoryDefaultSettingsProfile();
      expect(parsed.notationSizeMultiplier).toBe(fallback.notationSizeMultiplier);
      expect(parsed.systemRowGapPx).toBe(fallback.systemRowGapPx);
      // 範囲内の他フィールドは維持される
      expect(parsed.keySignature).toBe(VALID_PROFILE.keySignature);
    });

    it('不正な列挙値（scoreType・displayWeight・instrumentationPresetId）はそれぞれ既定値へ戻る', () => {
      const invalidEnums = {
        ...VALID_PROFILE,
        scoreType: 'orchestra-deluxe',
        displayWeight: 'ultra-bold',
        instrumentationPresetId: 'no-such-preset',
      };
      const parsed = parseSettingsProfile(JSON.stringify(invalidEnums));
      const fallback = getFactoryDefaultSettingsProfile();
      expect(parsed.scoreType).toBe(fallback.scoreType);
      expect(parsed.displayWeight).toBe(fallback.displayWeight);
      expect(parsed.instrumentationPresetId).toBe(fallback.instrumentationPresetId);
    });

    it('不正な拍子・調号は正規化された既定値へ戻る', () => {
      const invalidMusical = { ...VALID_PROFILE, timeSignature: [3, 3], keySignature: 'Z' };
      const parsed = parseSettingsProfile(JSON.stringify(invalidMusical));
      const fallback = getFactoryDefaultSettingsProfile();
      expect(parsed.timeSignature).toEqual(fallback.timeSignature);
      expect(parsed.keySignature).toBe(fallback.keySignature);
    });

    it('systemsPerPageSetting は null（未設定）を正しく保持する', () => {
      const withNull = { ...VALID_PROFILE, systemsPerPageSetting: null };
      const parsed = parseSettingsProfile(JSON.stringify(withNull));
      expect(parsed.systemsPerPageSetting).toBeNull();
    });

    it('systemsPerPageSetting が不正な数値（0以下・非整数）なら既定値（null）へ戻る', () => {
      const zeroSetting = { ...VALID_PROFILE, systemsPerPageSetting: 0 };
      expect(parseSettingsProfile(JSON.stringify(zeroSetting)).systemsPerPageSetting).toBeNull();

      const nonIntegerSetting = { ...VALID_PROFILE, systemsPerPageSetting: 2.5 };
      expect(parseSettingsProfile(JSON.stringify(nonIntegerSetting)).systemsPerPageSetting).toBeNull();
    });

    it('measuresPerSystem が範囲外（0や9）なら既定値の4へ戻る', () => {
      expect(parseSettingsProfile(JSON.stringify({ ...VALID_PROFILE, measuresPerSystem: 0 })).measuresPerSystem).toBe(4);
      expect(parseSettingsProfile(JSON.stringify({ ...VALID_PROFILE, measuresPerSystem: 9 })).measuresPerSystem).toBe(4);
    });
  });

  describe('localStorage 連携（保存・読込・削除・存在確認）', () => {
    it('save → load で往復できる', () => {
      saveSettingsProfile(withoutVersion(VALID_PROFILE));
      expect(loadSettingsProfile()).toEqual(VALID_PROFILE);
    });

    it('未保存のときは工場出荷既定値を読み込む', () => {
      expect(loadSettingsProfile()).toEqual(getFactoryDefaultSettingsProfile());
    });

    it('hasSettingsProfile は保存の有無を正しく反映する', () => {
      expect(hasSettingsProfile()).toBe(false);
      saveSettingsProfile(withoutVersion(VALID_PROFILE));
      expect(hasSettingsProfile()).toBe(true);
    });

    it('resetSettingsProfile で保存済みプロファイルを削除できる', () => {
      saveSettingsProfile(withoutVersion(VALID_PROFILE));
      expect(hasSettingsProfile()).toBe(true);

      resetSettingsProfile();
      expect(hasSettingsProfile()).toBe(false);
      expect(loadSettingsProfile()).toEqual(getFactoryDefaultSettingsProfile());
    });

    it('保存されたJSONは単一キー（SETTINGS_PROFILE_STORAGE_KEY）にまとまっている', () => {
      saveSettingsProfile(withoutVersion(VALID_PROFILE));
      const raw = window.localStorage.getItem(SETTINGS_PROFILE_STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual(VALID_PROFILE);
    });

    it('壊れたJSONが保存されていても loadSettingsProfile は例外を投げず既定値を返す', () => {
      window.localStorage.setItem(SETTINGS_PROFILE_STORAGE_KEY, '{broken');
      expect(() => loadSettingsProfile()).not.toThrow();
      expect(loadSettingsProfile()).toEqual(getFactoryDefaultSettingsProfile());
    });
  });
});
