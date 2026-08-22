// 段またぎ記譜（cross-staff）があるときの連桁（ビーム）の組み立て（Issue #313）。
//
// 段またぎでは「またぎ位置でビームを切る」（設計メモ §4-2）。段1a では
// 「同じ五線に連続して載る音符だけ」を `Beam.generateBeams` へ渡していたが、
// これだと**抜けた音符の拍が数えられず**、残りの音符の拍の区切りがずれる。
// `Beam.generateBeams` は渡された音符の tick（拍の内部単位）を先頭から
// 足し上げて区切りを決めるためで、8分3連の頭2音をまたぎに出すと、残り10音が
// 2/3拍ぶんずれた位置で束ねられて連符の境界と一致しなくなっていた。
//
// そこでここでは順序を入れ替え、
//   1. まず**全音符列**で拍の区切りを決める（＝またぎが無いときと同じ区切り）
//   2. その区切りを、またぎ位置（載る五線が変わる位置）で**さらに切る**
// という2段構えにしている。
import { Beam, type StaveNote, type StemmableNote } from 'vexflow';
import { splitIndexesByRenderTarget } from './crossStaffUtils';

/** `Beam.generateBeams` に渡す設定（VexFlow が型を公開していないので必要な項目だけ持つ） */
export type BeamGenerationOptions = Parameters<typeof Beam.generateBeams>[1];

/**
 * 音符が持つ「自分が属するビーム」の参照。
 *
 * VexFlow の型では `setBeam(beam: Beam)` しか公開されていないが、実体は
 * `beam` プロパティへの代入なので undefined を入れれば参照を外せる
 * （`hasBeam()` は `beam !== undefined` で判定している）。
 */
type BeamAssignableNote = { setBeam(beam: Beam | undefined): unknown };

/** 音符のビーム参照を外す（描画されないビームに属したままだと旗が出なくなる） */
function clearBeam(note: StemmableNote): void {
  (note as unknown as BeamAssignableNote).setBeam(undefined);
}

/**
 * 段またぎがある声部のビームを作る。
 *
 * 戻り値は描画に使う Beam の配列。1音だけになった断片にはビームを付けない
 * （その音符は旗＝flag で描かれる）。
 *
 * @param notes その声部の音符列（連符の tick 倍率は適用済みであること。Issue #217）
 * @param renderPartIndexes 音符ごとの「実際に載るパート番号」（`notes` と同じ並び）
 * @param beamOptions 従来 `Beam.generateBeams` に渡していた設定をそのまま渡す
 */
export function generateCrossStaffBeams(
  notes: readonly StaveNote[],
  renderPartIndexes: readonly number[],
  beamOptions: BeamGenerationOptions
): Beam[] {
  // 手順1: またぎが無いときとまったく同じ「拍の区切り」を求める。ここで作られる Beam は
  // 「どこで拍が切れるか」を知るためだけのもので、描画には使わず捨てる。
  //
  // 注意（Codex 1巡目 P1）: 区切り決定に符幹方向オプションを渡してはいけない。
  // 声部2では maintainStemDirections: true が来ており、またぎ音符（向き未設定=自動）と
  // 自五線の音符（下向き固定）の**方向の変化位置でグループが先に分断**され、
  // またぎ検出（crossing）に届く前に各グループが単一五線になってしまう。
  // 区切りは純粋に拍だけで決め、方向は後段（またぎ=五線間向き / 非またぎ=元のオプション）で付ける。
  const {
    stemDirection: _ignoredStemDirection,
    maintainStemDirections: _ignoredMaintain,
    ...beatOnlyOptions
  } = (beamOptions ?? {}) as Record<string, unknown>;
  // 区切り決定パスは符幹方向を書き換える（自動判定を適用する）ので、先に控えて後で戻す。
  // 戻さないと、非またぎグループの再生成（maintainStemDirections: true）が
  // 「自動判定に上書きされた向き」を維持してしまい、声部の向き固定（#239）が壊れる。
  //
  // 注意: 音符列には GhostNote（追加声部の前後のダミー休符を表示だけ消した詰め物）が
  // 混ざることがあり、GhostNote は符幹を持たないため getStemDirection() が NoStem 例外を
  // 投げる（月光の実データで小節ごと描画が落ちた回帰）。符幹の無い音符は控え・復元の
  // 対象外にする（ビームのグループにも入らないので向きの問題は起きない）
  const getDirectionSafely = (note: StemmableNote): number | undefined => {
    try {
      return note.getStemDirection();
    } catch {
      return undefined;
    }
  };
  const originalDirections = notes.map(note => getDirectionSafely(note as StemmableNote));
  const beatGroups = Beam.generateBeams([...notes] as StemmableNote[], beatOnlyOptions);
  notes.forEach((note, index) => {
    const original = originalDirections[index];
    if (original === undefined) return;
    if (getDirectionSafely(note as StemmableNote) !== original) {
      (note as StemmableNote).setStemDirection(original);
    }
  });
  const indexOfNote = new Map<StemmableNote, number>();
  notes.forEach((note, index) => indexOfNote.set(note as StemmableNote, index));

  // 捨てるビームの参照が音符に残ると、その音符は「ビームがある」と判断されて
  // 旗を描かなくなる（ビーム本体は描かれないので符尾だけの裸の音符になる）。
  // 手順3 で作り直す前に、いったん全部の参照を外しておく。
  notes.forEach(note => clearBeam(note as StemmableNote));

  // 手順2: 拍グループごとに「またぎを含むか」で分岐する。
  // 束ねる対象にならなかった音符（4分音符など）は beatGroups に現れないので、
  // ここに出てこない音符は従来どおりビーム無しのまま。
  return beatGroups.flatMap(beam => {
    const indexes = beam.getNotes()
      .map(note => indexOfNote.get(note))
      .filter((index): index is number => index !== undefined);
    const firstPart = renderPartIndexes[indexes[0]];
    const crossing = indexes.some(index => renderPartIndexes[index] !== firstPart);

    if (!crossing) {
      // またぎの無いグループは従来どおり（符幹の向きもグループ単位で自動決定）
      return splitIndexesByRenderTarget(indexes, renderPartIndexes).flatMap(fragment =>
        Beam.generateBeams(fragment.map(index => notes[index]) as StemmableNote[], beamOptions)
      );
    }

    // ── 段またぎ連桁（Issue #259 段2）──
    // 段1では「またぎ位置でビームを切る」だったが、市販譜の慣行どおり
    // 1本のビームを五線間に斜めに渡す。作り方:
    //   1. 符幹の向きを「五線の間」へ向ける（グループ内で上の五線に載る音は下向き、
    //      下の五線に載る音は上向き）。ビームは両方の符幹の先端の間＝五線間に置かれる
    //   2. Beam.generateBeams ではなく new Beam(...) を使う。generateBeams は
    //      グループの向きを1方向へ揃え直すが、コンストラクタは既存の向きを保つ
    //      （混在方向のビームは VexFlow が公式にサポートする段またぎの描き方。
    //      実挙動はプローブテストで確認済み: ビームのパスは五線の間の y に描かれる）
    // 多声小節の「声部1=上向き」固定より、またぎグループの向きを優先する
    // （浄書上、またぎ連桁の符幹は五線間へ向けるのが前提のため）。
    const groupNotes = indexes.map(index => notes[index] as StemmableNote);
    const topPart = Math.min(...indexes.map(index => renderPartIndexes[index]));
    groupNotes.forEach((note, k) => {
      const notePart = renderPartIndexes[indexes[k]];
      note.setStemDirection(notePart === topPart ? -1 : 1);
    });
    const spanning = new Beam(groupNotes);
    // 合同整形後の復元（restoreCrossStaffBeamAssignments）が混在方向を
    // 一律方向で潰さないよう、作成時点の向きを記録しておく
    crossStaffBeamStemDirections.set(
      spanning,
      new Map(groupNotes.map(note => [note, note.getStemDirection()])),
    );
    return [spanning];
  });
}

/**
 * 段またぎ連桁（混在方向ビーム）の「作成時点の符幹の向き」の台帳。
 * restoreCrossStaffBeamAssignments が復元時に参照する。WeakMap なので
 * ビームが捨てられれば記録も一緒に消える（描画ごとに作り直す運用と整合）。
 */
const crossStaffBeamStemDirections = new WeakMap<Beam, Map<StemmableNote, number>>();

/**
 * 合同整形のあとで、ビームの「参照」と「符幹の向き」をビーム自身の記録から復元する（Issue #319）。
 *
 * なぜ必要か: 同じ拍に複数の音符が重なると、整形中に VexFlow の衝突解決
 * （`ModifierContext.preFormat` → `StaveNote.format`）がどれかの符幹の向きを
 * 反転させることがある。`setStemDirection` は内部で `this.beam = undefined` を
 * **直接代入**するため（setBeam を経由しない）、ビーム済みの音符から参照だけが
 * 静かに消え、描画時に「ビーム無し」と誤判定されて余分な旗が描かれる。
 *
 * 段またぎの音符は、移した先の五線で相手パートの音符と同じ拍・同じ五線に載るため、
 * この衝突解決の対象に初めてなった（またぎが無い譜面では同一 tick の音符は
 * ModifierContext 上で五線が分かれており、ビーム済み音符の向きが反転される
 * 組み合わせが生じない）。そのため復元は段またぎのある声部だけに適用すればよい。
 *
 * 向きも一緒に戻すのは、ビームで繋がったグループの符幹は同方向が浄書の前提で、
 * 片方だけ反転したままだとビームの形が壊れるため。`setStemDirection` は再び
 * 参照を消すので、必ず「向き → 参照」の順で復元する。
 */
export function restoreCrossStaffBeamAssignments(beams: readonly Beam[]): void {
  beams.forEach(beam => {
    // 段またぎ連桁（段2）は符幹の向きが混在するので、作成時点の記録から音符ごとに戻す。
    // 記録が無いビーム（またぎを含まない従来グループ）はビームの一律方向でよい
    const recorded = crossStaffBeamStemDirections.get(beam);
    const uniformDirection = beam.getStemDirection();
    beam.getNotes().forEach(note => {
      const direction = recorded?.get(note) ?? uniformDirection;
      if (note.getStemDirection() !== direction) {
        note.setStemDirection(direction);
      }
      note.setBeam(beam);
    });
  });
}
