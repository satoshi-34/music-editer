// 矢印キーの初回ヒント（Issue #524）の既読管理テスト。
// 「一度だけ出す」は #497 と同じ性質（毎回出れば邪魔・一度も出なければ意味が無い）なので、
// 既読フラグの読み書きと、localStorage が使えないときの振る舞いを固定する。
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import {
  ARROW_KEY_HINT_NOTICE_DURATION_MS,
  ARROW_KEY_HINT_NOTICE_MESSAGE,
  ARROW_KEY_HINT_NOTICE_SEEN_KEY,
  claimArrowKeyHintNotice,
  hasSeenArrowKeyHintNotice,
  resetArrowKeyHintNoticeForTest,
} from './arrowKeyHintNotice';
import { STORAGE_LOCATION_NOTICE_SEEN_KEY, claimStorageLocationNotice, resetStorageLocationNoticeForTest } from './storageLocationNotice';

/** localStorage を差し替える。戻り値を呼ぶと元へ戻す */
function useFakeLocalStorage(impl: Partial<Storage>): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { value: impl, configurable: true });
  return () => {
    if (original) Object.defineProperty(window, 'localStorage', original);
  };
}

// setupTests.ts は「使い慣れたユーザー（既読）」を既定にしているので、
// ヒントそのものを試すこのファイルだけは毎回**未読**へ戻してから始める。
beforeEach(() => {
  localStorage.removeItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY);
  localStorage.removeItem(STORAGE_LOCATION_NOTICE_SEEN_KEY);
  resetArrowKeyHintNoticeForTest();
  resetStorageLocationNoticeForTest();
});

afterEach(() => {
  try {
    localStorage.removeItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY);
    localStorage.removeItem(STORAGE_LOCATION_NOTICE_SEEN_KEY);
  } catch {
    // 差し替えたままのケースは各テスト側で戻している
  }
  resetArrowKeyHintNoticeForTest();
  resetStorageLocationNoticeForTest();
});

describe('矢印キーの初回ヒント（#524）', () => {
  it('claim は初回だけ true。同じ読み込み中の2回目も、次の読み込みも false', () => {
    // #497（起動時の説明）は StrictMode の再実行で出し直すため2回目も true を返すが、
    // こちらのきっかけは「音符を選ぶ」というユーザー操作で、選び直すたびに走る。
    // 同じ逃がしを使うと選択のたびに出てしまうので、既読だけで判定する。
    resetArrowKeyHintNoticeForTest();
    expect(claimArrowKeyHintNotice()).toBe(true);   // 初回: 表示する+既読を記録
    expect(hasSeenArrowKeyHintNotice()).toBe(true);
    expect(claimArrowKeyHintNotice()).toBe(false);  // 2つ目の音符を選び直した相当: 出さない
    resetArrowKeyHintNoticeForTest();               // 次のページ読み込み相当
    expect(claimArrowKeyHintNotice()).toBe(false);  // 既読なので出さない（受入条件1: 再読込後も出ない）
  });

  it('本文はその場で試せる3つ（↑↓・←→・Delete）を書き、残りはヘルプへ誘導する', () => {
    expect(ARROW_KEY_HINT_NOTICE_MESSAGE).toContain('↑↓');
    expect(ARROW_KEY_HINT_NOTICE_MESSAGE).toContain('←→');
    expect(ARROW_KEY_HINT_NOTICE_MESSAGE).toContain('Delete');
    expect(ARROW_KEY_HINT_NOTICE_MESSAGE).toContain('キーボードショートカット');
    // 4秒（編集通知の既定）では読み切れない長さなので、#497 と同じ長めの表示時間にする
    expect(ARROW_KEY_HINT_NOTICE_DURATION_MS).toBe(10000);
  });

  it('保存先の説明（#497）とは別のキーで覚えるので、片方を見てももう片方は出る', () => {
    // 共通部品（onceNotice）へまとめた際に、うっかり同じキー・同じフラグを共有すると
    // 「起動時の説明を見たら矢印キーのヒントが二度と出ない」という取りこぼしになる。
    expect(ARROW_KEY_HINT_NOTICE_SEEN_KEY).not.toBe(STORAGE_LOCATION_NOTICE_SEEN_KEY);
    resetStorageLocationNoticeForTest();
    resetArrowKeyHintNoticeForTest();
    expect(claimStorageLocationNotice()).toBe(true);
    expect(claimArrowKeyHintNotice()).toBe(true);
  });

  it('localStorage が使えなくても例外を投げない（プライベートブラウジング等）', () => {
    const restore = useFakeLocalStorage({
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    } as unknown as Storage);
    try {
      resetArrowKeyHintNoticeForTest();
      expect(hasSeenArrowKeyHintNotice()).toBe(false);
      // 既読は記録できないが、メモリ側フラグで「同じ読み込み中は一度だけ」を守る
      //（round1 P2: 書き込み失敗環境で選択のたびに出てしまう退行の固定）
      expect(claimArrowKeyHintNotice()).toBe(true);
      expect(claimArrowKeyHintNotice()).toBe(false);
    } finally {
      restore();
    }
  });
});
