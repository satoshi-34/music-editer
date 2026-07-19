import { describe, expect, it } from 'vitest';
import {
  findPageIndexForSystem,
  getPageSystemOffset,
  getPageSystemsCapacity,
  shouldReduceFirstPageSystems,
} from './pageSystemLayoutUtils';

describe('pageSystemLayoutUtils', () => {
  describe('shouldReduceFirstPageSystems', () => {
    it('タイトルページのヘッダーがあり、段数/ページが2以上なら1ページ目を減らす', () => {
      expect(shouldReduceFirstPageSystems({ systemsPerPage: 5, hasTitlePageHeader: true })).toBe(true);
    });

    it('タイトル・作曲者名が空なら、全ページ同数のまま減らさない', () => {
      expect(shouldReduceFirstPageSystems({ systemsPerPage: 5, hasTitlePageHeader: false })).toBe(false);
    });

    it('段数/ページが1のときは、0段になってしまうため減らさない', () => {
      expect(shouldReduceFirstPageSystems({ systemsPerPage: 1, hasTitlePageHeader: true })).toBe(false);
    });
  });

  describe('getPageSystemsCapacity', () => {
    const options = { systemsPerPage: 5, hasTitlePageHeader: true };

    it('1ページ目だけ段数/ページ-1段になる', () => {
      expect(getPageSystemsCapacity(0, options)).toBe(4);
    });

    it('2ページ目以降は段数/ページどおり', () => {
      expect(getPageSystemsCapacity(1, options)).toBe(5);
      expect(getPageSystemsCapacity(2, options)).toBe(5);
    });

    it('ヘッダーが無ければ1ページ目も同数', () => {
      const noHeader = { systemsPerPage: 5, hasTitlePageHeader: false };
      expect(getPageSystemsCapacity(0, noHeader)).toBe(5);
    });

    it('段数/ページが1のときは1ページ目も1段のまま', () => {
      const single = { systemsPerPage: 1, hasTitlePageHeader: true };
      expect(getPageSystemsCapacity(0, single)).toBe(1);
      expect(getPageSystemsCapacity(1, single)).toBe(1);
    });
  });

  describe('getPageSystemOffset', () => {
    const options = { systemsPerPage: 5, hasTitlePageHeader: true };

    it('0ページ目のオフセットは常に0', () => {
      expect(getPageSystemOffset(0, options)).toBe(0);
    });

    it('1ページ目は「1ページ目の段数（4）」から始まる', () => {
      expect(getPageSystemOffset(1, options)).toBe(4);
    });

    it('2ページ目以降は 4 + (pageIndex - 1) * 5 で累積する', () => {
      expect(getPageSystemOffset(2, options)).toBe(9);
      expect(getPageSystemOffset(3, options)).toBe(14);
    });

    it('ヘッダーが無ければ単純な等間隔オフセットになる', () => {
      const noHeader = { systemsPerPage: 5, hasTitlePageHeader: false };
      expect(getPageSystemOffset(1, noHeader)).toBe(5);
      expect(getPageSystemOffset(2, noHeader)).toBe(10);
    });
  });

  describe('findPageIndexForSystem', () => {
    const options = { systemsPerPage: 5, hasTitlePageHeader: true };

    it('1ページ目の範囲内（段0〜3）は0を返す', () => {
      expect(findPageIndexForSystem(0, options)).toBe(0);
      expect(findPageIndexForSystem(3, options)).toBe(0);
    });

    it('2ページ目の範囲（段4〜8）は1を返す', () => {
      expect(findPageIndexForSystem(4, options)).toBe(1);
      expect(findPageIndexForSystem(8, options)).toBe(1);
    });

    it('3ページ目の範囲（段9〜13）は2を返す', () => {
      expect(findPageIndexForSystem(9, options)).toBe(2);
      expect(findPageIndexForSystem(13, options)).toBe(2);
    });
  });
});
