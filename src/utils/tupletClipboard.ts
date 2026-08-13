import type { NoteEvent } from '../types/storage';

/**
 * 連符グループ用の内部クリップボード（Issue #234）。
 *
 * なぜ React の state ではなくモジュール変数なのか:
 * コピー元・貼り付け先はどちらも PianoSystemCanvas だが、1ページの中に段の数だけ
 * インスタンスが並ぶ（段2でコピーして段5へ貼る、という操作が普通に起きる）。
 * ScorePage の state に持たせると 4 つのラッパー（Piano/Single/Quartet/Ensemble）を
 * 経由して props を配り直すことになるため、「コピーした中身」だけを共有する
 * 小さな置き場をモジュール側に置いている。
 *
 * 中身は「イベント配列（音符1つ＋連符内休符…）」であって描画状態は持たない。
 * 貼り付け時に必ず新しいグループ id を振り直すので、ここに入っている
 * tuplet.id が使い回されることはない（tupletUtils.instantiateTupletGroup 参照）。
 */
let clipboardGroup: NoteEvent[] | null = null;

type ClipboardListener = () => void;
const listeners = new Set<ClipboardListener>();

/**
 * 連符グループをクリップボードへ入れる（null で空にする）。
 * 小節コピペと同じ「最後にコピーしたものが貼られる」後勝ちにするため、
 * 変更を購読している ScorePage 側が小節クリップボードを空にする。
 */
export function setTupletClipboardGroup(events: NoteEvent[] | null): void {
  clipboardGroup = events && events.length > 0 ? events : null;
  listeners.forEach((listener) => listener());
}

/** いまクリップボードに入っている連符グループ（無ければ null）。 */
export function getTupletClipboardGroup(): NoteEvent[] | null {
  return clipboardGroup;
}

/**
 * クリップボードの変化を購読する。戻り値を呼ぶと購読を解除する
 * （React の useEffect のクリーンアップにそのまま渡せる形にしてある）。
 */
export function subscribeTupletClipboard(listener: ClipboardListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
