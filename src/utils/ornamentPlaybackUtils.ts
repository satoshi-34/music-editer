// トリルの再生対応（弟フィードバック 2026-08-29「トリル再生されるようにしてほしい」）。
//
// 装飾記号はこれまで見た目だけで、再生では主音符が音価どおり1回鳴るだけだった。
// 楽譜制作ソフトでは「作業中の確認音＝完成音源」（弟インタビュー知見）なので、
// トリルは主音と上隣接音（調号に沿った音階上の音）の交互連打として鳴らす。
//
// なぜここ（純関数・データ変換）でやるのか:
// 再生は ScorePage が PlaybackMeasureEvent の列を作って playParts へ渡す構造で、
// 内蔵音源（SimpleAudioEngine）と SoundFont（SoundFontEngine）の両方が同じ列を読む。
// エンジンへ渡す前にイベント列を展開しておけば、両エンジンへ同時に効き、
// エンジン側のコードには1行も手を入れずに済む（二重実装を作らない方針）。
//
// 展開の表現: サブ音符の dur 文字列（'32' / '64'）に元と同じ dots・tuplet を引き継ぐ。
// エンジンは dur/dots/tuplet から拍数を計算して順に鳴らすため、
// 「サブ音符の合計拍 = 元の音価の拍」でありさえすれば拍はずれない
// （dots/tuplet の倍率はサブ音符側にも同じ倍率で掛かるので、分割数は常に整数になる）。
//
// モルデント・プラルトリラー・ターンは「残り時間ぶん主音を伸ばす」表現に
// 任意長の音価が必要（dur 文字列で表せない）ため今回は対象外（設計判断）。
import type { NoteEvent } from '../types/storage';
import type { KeySignature } from './noteKeyUtils';
import { applyKeySignatureToNaturalKey, parseNoteKey } from './noteKeyUtils';
import { getDurationBeats } from './voiceMeasureUtils';

/** startBeat つきの再生イベント（voiceMeasureUtils.PlaybackMeasureEventWithStart と同じ形） */
type PlaybackEventLike = NoteEvent & { startBeat?: number; velocity?: number; durationScale?: number };

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'] as const;

/**
 * トリルの上隣接音（音階上のひとつ上の音）を返す。
 * 綴りの文字を1つ上げ（b→c でオクターブ繰り上げ）、調号の臨時記号を適用する。
 * 主音側の臨時記号（f#/4 など）は上隣接音には引き継がない（音階上の音をそのまま使う）。
 * 解析できないキーは null（呼び出し側は展開しない）。
 */
export function trillUpperNeighborKey(key: string, keySignature: KeySignature): string | null {
  const parsed = parseNoteKey(key);
  if (!parsed) return null;
  const letterIndex = LETTERS.indexOf(parsed.letter);
  if (letterIndex < 0) return null;
  const upperLetter = LETTERS[(letterIndex + 1) % LETTERS.length];
  const upperOctave = parsed.letter === 'b' ? parsed.octave + 1 : parsed.octave;
  return applyKeySignatureToNaturalKey(`${upperLetter}/${upperOctave}`, keySignature);
}

/** サブ音符の候補（速い順）。トリルの粒は 32分を基本とし、短い主音符だけ 64分へ落とす */
const SUB_DURS: Array<NoteEvent['dur']> = ['32', '64'];
/** これ未満の分割しかできない音価（32分・64分など）は展開しない */
const MIN_SUB_NOTES = 4;

/**
 * トリルつきイベントを「主音と上隣接音の交互連打」へ展開する。
 *
 * 展開しない（元のイベントをそのまま1個で返す）条件:
 * - ornament が trill でない・休符・和音（トリル対象音が定まらない）・微分音つき
 * - 音価が短すぎて4分割未満にしかならない（32分・64分の主音符）
 * - キーが解析できない
 *
 * 交互は主音から始め、**最後は必ず主音**で終える（偶数分割では末尾2つが主音になる。
 * 上隣接音で切れると解決感がなく不自然なため）。
 * velocity / durationScale / startBeat は元イベントから引き継ぐ
 * （startBeat はサブ音符ごとに実拍ぶん進める。無ければ省略のまま＝エンジン側の累積で進む）。
 */
export function expandTrillForPlayback(
  event: PlaybackEventLike,
  keySignature: KeySignature,
  options?: { swingActive?: boolean },
): PlaybackEventLike[] {
  if (event.ornament !== 'trill' || event.isRest) return [event];
  if (!event.keys || event.keys.length !== 1) return [event];
  if (event.microtones && event.microtones.length > 0) return [event];
  // スウィングON時、スウィング対象になり得る音（付点なし8分）は展開しない。
  // 32分へ割るとエンジンのスウィング判定（8分のみ）から外れ、裏拍の 2/3 シフトが
  // 消えて実音とハイライトの位置がずれるため（Codex round1 P2）
  if (options?.swingActive && event.dur === '8' && !event.dots) return [event];

  const upperKey = trillUpperNeighborKey(event.keys[0], keySignature);
  if (!upperKey) return [event];

  const totalPlainBeats = getDurationBeats(event.dur, event.dots);
  for (const subDur of SUB_DURS) {
    const subPlainBeats = getDurationBeats(subDur);
    const count = Math.round(totalPlainBeats / subPlainBeats);
    // 丸め誤差ではなく厳密に割り切れる分割だけを使う（拍を1msも壊さない）
    if (Math.abs(count * subPlainBeats - totalPlainBeats) > 1e-9) continue;
    if (count < MIN_SUB_NOTES) continue;

    const subs: PlaybackEventLike[] = [];
    for (let i = 0; i < count; i += 1) {
      // 主音→上隣接音の交互。最後のサブ音符は必ず主音で終える
      const isMain = i % 2 === 0 || i === count - 1;
      subs.push({
        ...event,
        ornament: undefined,
        dur: subDur,
        // 付点は分割数（個数）で表現済み。サブ音符へ引き継ぐと拍が 1.5 倍に膨らむ
        dots: undefined,
        keys: [isMain ? event.keys[0] : upperKey],
        // tuplet は倍率としてだけ引き継ぐ。id を残すと描画・整合チェック側の
        // 「グループ=同じ id の連続」数えと衝突するため、再生専用の別 id にする
        tuplet: event.tuplet
          ? { ...event.tuplet, id: `${event.tuplet.id}--trill-${i}` }
          : undefined,
        startBeat: event.startBeat != null
          ? event.startBeat + i * subPlainBeats * (event.tuplet ? event.tuplet.notesOccupied / event.tuplet.numNotes : 1)
          : undefined,
      });
    }
    return subs;
  }
  return [event];
}
