// src/audio/scheduleLead.ts
// 再生の予約開始時刻に足す「先読みリード」（Issue #610）。
//
// playParts は「開始時刻＝今」から曲全体（長い曲では数百音）の予約ループを回す。
// 予約処理そのものに実時間がかかるため、リードが無いと予約完了時点で先頭の音の
// 開始時刻がすでに過去になり、頭の音がアタック途中から鳴る（ずれ＋プツ）。
// 和音は同時刻の複数ソースで被害が大きい（運用者QA 2026-09-03「最初の音がずれる／プツる／
// 和音が苦手」）。内蔵音源・SoundFont の両エンジンで同じ値を使う（二重実装禁止）。
//
// 値は dev のチューニングパネル（#596）で運用者の耳で確定する。
// 再生ボタン押下→発音の体感遅延がこの秒数ぶん増えるが、頭欠けの解消を優先する。
import { devTuned } from '../utils/devTuning';

export const SCHEDULE_LEAD_SECONDS = 0.1;

/** 実効値（dev では #596 の上書きを通す。本番は定数そのもの） */
export function scheduleLeadSeconds(): number {
  return import.meta.env.DEV
    ? devTuned('audio.scheduleLead', SCHEDULE_LEAD_SECONDS)
    : SCHEDULE_LEAD_SECONDS;
}
