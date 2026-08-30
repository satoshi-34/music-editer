// 保存先の初回説明（Issue #497）の既読管理テスト。
// 「一度だけ出す」はユーザーの信頼に関わる（毎回出れば邪魔・一度も出なければ意味が無い）ので、
// 既読フラグの読み書きと、localStorage が使えないときの振る舞いを固定する。
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  STORAGE_LOCATION_NOTICE_SEEN_KEY,
  STORAGE_LOCATION_NOTICE_MESSAGE,
  claimStorageLocationNotice,
  hasSeenStorageLocationNotice,
  markStorageLocationNoticeSeen,
  resetStorageLocationNoticeForTest,
} from './storageLocationNotice';

/** localStorage を差し替える。戻り値を呼ぶと元へ戻す */
function useFakeLocalStorage(impl: Partial<Storage>): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { value: impl, configurable: true });
  return () => {
    if (original) Object.defineProperty(window, 'localStorage', original);
  };
}

afterEach(() => {
  try {
    localStorage.removeItem(STORAGE_LOCATION_NOTICE_SEEN_KEY);
  } catch {
    // 差し替えたままのケースは各テスト側で戻している
  }
});

describe('保存先の初回説明（#497）', () => {
  it('初回は未読で、既読にすると次からは読まれない', () => {
    expect(hasSeenStorageLocationNotice()).toBe(false);
    markStorageLocationNoticeSeen();
    expect(hasSeenStorageLocationNotice()).toBe(true);
  });

  it('本文は「端末にのみ保存」を言い、送信の否定は「自動で」に限定する（round1 P1）', () => {
    expect(STORAGE_LOCATION_NOTICE_MESSAGE).toContain('この端末にのみ保存');
    // PDF取り込み（β）はユーザーが選んだ PDF を変換サーバーへ送る例外があるため、
    // 例外なしの断定（「サーバーには送信されません」）に戻ると嘘になる。
    // 「自動で〜送信されることはありません」という限定表現であることを固定する
    expect(STORAGE_LOCATION_NOTICE_MESSAGE).toContain('自動でサーバーへ送信されることはありません');
    expect(STORAGE_LOCATION_NOTICE_MESSAGE).not.toMatch(/(?<!自動で)サーバーには送信されません/);
  });

  it('claim は初回 true・以後の読み込みでは false、同じ読み込み内の再実行（StrictMode）では true を返し続ける', () => {
    resetStorageLocationNoticeForTest();
    expect(claimStorageLocationNotice()).toBe(true);   // 初回: 表示する+既読を記録
    expect(hasSeenStorageLocationNotice()).toBe(true);
    expect(claimStorageLocationNotice()).toBe(true);   // StrictMode の再実行相当: 出し直す
    resetStorageLocationNoticeForTest();               // 次のページ読み込み相当
    expect(claimStorageLocationNotice()).toBe(false);  // 既読なので出さない
  });

  it('localStorage が使えなくても例外を投げない（プライベートブラウジング等）', () => {
    const restore = useFakeLocalStorage({
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    } as unknown as Storage);
    try {
      // 読めないときは「未読」として扱う（説明の内容自体は常に正しいので、出るぶんには害が無い）
      expect(hasSeenStorageLocationNotice()).toBe(false);
      expect(() => markStorageLocationNoticeSeen()).not.toThrow();
    } finally {
      restore();
    }
  });

  it('保存に失敗しても呼び出し側へ例外を伝えない', () => {
    const setItem = vi.fn(() => { throw new Error('QuotaExceededError'); });
    const restore = useFakeLocalStorage({
      getItem: () => null,
      setItem,
    } as unknown as Storage);
    try {
      expect(() => markStorageLocationNoticeSeen()).not.toThrow();
      expect(setItem).toHaveBeenCalledWith(STORAGE_LOCATION_NOTICE_SEEN_KEY, '1');
    } finally {
      restore();
    }
  });
});
