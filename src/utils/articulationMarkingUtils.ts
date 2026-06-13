import type { ArticulationMarking, NoteEvent } from '../types/storage';

/** パレットに並べる順番でもある、扱うアーティキュレーションの一覧 */
export const ARTICULATION_VALUES: ArticulationMarking[] = [
  'staccato',
  'accent',
  'tenuto',
  'marcato',
  'fermata',
];

const ARTICULATION_SET = new Set<string>(ARTICULATION_VALUES);

export function isArticulationMarkingValue(value: unknown): value is ArticulationMarking {
  return typeof value === 'string' && ARTICULATION_SET.has(value);
}

/**
 * VexFlow の Articulation に渡す記号コード。
 * （'a.' = スタッカート点、'a>' = アクセント、'a-' = テヌート、
 *   'a^' = マルカート、'a@a' = フェルマータ（上付き））
 */
const VEXFLOW_CODE: Record<ArticulationMarking, string> = {
  staccato: 'a.',
  accent: 'a>',
  tenuto: 'a-',
  marcato: 'a^',
  fermata: 'a@a',
};

export function getArticulationVexflowCode(value: ArticulationMarking): string {
  return VEXFLOW_CODE[value];
}

/**
 * 音符の上側に描く記号かどうか。
 * フェルマータとマルカートは慣習的に常に符頭の上に置くため、
 * VexFlow の自動配置に任せず明示的に上付きへ固定する。
 * （VexFlow の Position.ABOVE = 3）
 */
export function isAboveArticulation(value: ArticulationMarking): boolean {
  return value === 'fermata' || value === 'marcato';
}

/** 再生時の効き方（音の長さと音量それぞれの倍率） */
export interface ArticulationPlaybackEffect {
  /** 音価に対する「実際に鳴らす長さ」の倍率（1 未満で短く切れる） */
  durationScale: number;
  /** ベロシティ（音量）の倍率（1 より大きいと強く鳴る） */
  velocityScale: number;
}

// 記号ごとの再生効果。複数付いているときは倍率を掛け合わせる。
const PLAYBACK_EFFECT: Record<ArticulationMarking, ArticulationPlaybackEffect> = {
  // スタッカート: 音をはっきり短く切る
  staccato: { durationScale: 0.5, velocityScale: 1.0 },
  // アクセント: 同じ長さのまま、その音だけ強く
  accent: { durationScale: 1.0, velocityScale: 1.3 },
  // テヌート: 音価いっぱい保ち、ほんの少し強めに
  tenuto: { durationScale: 1.0, velocityScale: 1.05 },
  // マルカート: 強く＋やや短く、輪郭をはっきりさせる
  marcato: { durationScale: 0.7, velocityScale: 1.4 },
  // フェルマータ: その音を長めに伸ばす
  fermata: { durationScale: 1.8, velocityScale: 1.0 },
};

/**
 * 音符に付いた全アーティキュレーションをまとめて、再生用の倍率に畳み込む。
 * 記号が無ければ「等倍（何も変えない）」を返す。
 */
export function getArticulationPlaybackEffect(event: NoteEvent): ArticulationPlaybackEffect {
  const list = event.articulations ?? [];
  return list.reduce<ArticulationPlaybackEffect>(
    (acc, value) => {
      const effect = PLAYBACK_EFFECT[value];
      if (!effect) {
        return acc;
      }
      return {
        durationScale: acc.durationScale * effect.durationScale,
        velocityScale: acc.velocityScale * effect.velocityScale,
      };
    },
    { durationScale: 1, velocityScale: 1 }
  );
}

/**
 * 音符にアーティキュレーションをトグルで付け外しする。
 * すでに同じ記号が付いていれば外し、無ければ追加する。
 * 休符には付けられない（鳴らし方を指示する記号のため）。
 */
export function toggleArticulationOnEvent(event: NoteEvent, value: ArticulationMarking): NoteEvent {
  if (event.isRest) {
    return event;
  }

  const current = event.articulations ?? [];
  const exists = current.includes(value);
  const next = exists
    ? current.filter((item) => item !== value)
    : [...current, value];

  // 空になったら配列ごと消して、保存データを軽く保つ。
  return next.length > 0
    ? { ...event, articulations: next }
    : { ...event, articulations: undefined };
}
