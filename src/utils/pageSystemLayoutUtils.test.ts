import { describe, expect, it } from 'vitest';
import {
  findPageIndexForSystem,
  getPageSystemOffset,
  getPageSystemsCapacity,
} from './pageSystemLayoutUtils';

describe('pageSystemLayoutUtils', () => {
  describe('getPageSystemsCapacity', () => {
    const options = { systemsPerPage: 5 };

    it('全ページ、常に段数/ページどおりの段数になる（タイトルページも例外なし）', () => {
      expect(getPageSystemsCapacity(0, options)).toBe(5);
      expect(getPageSystemsCapacity(1, options)).toBe(5);
      expect(getPageSystemsCapacity(2, options)).toBe(5);
    });

    it('段数/ページが1のときも常に1段のまま', () => {
      const single = { systemsPerPage: 1 };
      expect(getPageSystemsCapacity(0, single)).toBe(1);
      expect(getPageSystemsCapacity(1, single)).toBe(1);
    });
  });

  describe('getPageSystemOffset', () => {
    const options = { systemsPerPage: 5 };

    it('0ページ目のオフセットは常に0', () => {
      expect(getPageSystemOffset(0, options)).toBe(0);
    });

    it('1ページ目以降は pageIndex * systemsPerPage で単純な等間隔オフセットになる', () => {
      expect(getPageSystemOffset(1, options)).toBe(5);
      expect(getPageSystemOffset(2, options)).toBe(10);
      expect(getPageSystemOffset(3, options)).toBe(15);
    });
  });

  describe('findPageIndexForSystem', () => {
    const options = { systemsPerPage: 5 };

    it('1ページ目の範囲内（段0〜4）は0を返す', () => {
      expect(findPageIndexForSystem(0, options)).toBe(0);
      expect(findPageIndexForSystem(4, options)).toBe(0);
    });

    it('2ページ目の範囲（段5〜9）は1を返す', () => {
      expect(findPageIndexForSystem(5, options)).toBe(1);
      expect(findPageIndexForSystem(9, options)).toBe(1);
    });

    it('3ページ目の範囲（段10〜14）は2を返す', () => {
      expect(findPageIndexForSystem(10, options)).toBe(2);
      expect(findPageIndexForSystem(14, options)).toBe(2);
    });
  });
});
