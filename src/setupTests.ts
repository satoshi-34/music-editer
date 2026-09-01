// src/setupTests.ts
// テストセットアップファイル

import { beforeEach } from 'vitest';
import '@testing-library/jest-dom';

import { ARROW_KEY_HINT_NOTICE_SEEN_KEY } from './utils/arrowKeyHintNotice';

// 「初回だけ出す」通知（Issue #524 の矢印キーのヒント）は、既定で**既読**にしておく。
//
// なぜここでやるか: このヒントは音符を初めて選択したときに通知系（#318）へ1件流れる。
// 既存のテストの多くは「操作の結果として出た通知」を件数で確かめているため、
// 既定が未読のままだと、音符を選ぶテストすべてに1件よけいな通知が混ざって落ちる。
// テストの初期状態は「アプリを使い慣れたユーザー（＝もう見た）」にそろえるのが自然で、
// ヒント自体の動きは専用テスト（PianoSystemCanvasArrowKeyHint.test.tsx）が
// このキーを消したうえで確かめている。
beforeEach(() => {
  try {
    localStorage.setItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY, '1');
  } catch {
    // localStorage が使えない環境ではヒントが出るが、その場合も各テストは
    // 自分の期待値を持っているので、ここで失敗させる必要はない
  }
});
