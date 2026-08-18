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
  // 手順1: またぎが無いときとまったく同じ区切りを求める。ここで作られる Beam は
  // 「どこで拍が切れるか」を知るためだけのもので、描画には使わず捨てる。
  const beatGroups = Beam.generateBeams([...notes] as StemmableNote[], beamOptions);
  const indexOfNote = new Map<StemmableNote, number>();
  notes.forEach((note, index) => indexOfNote.set(note as StemmableNote, index));

  // 捨てるビームの参照が音符に残ると、その音符は「ビームがある」と判断されて
  // 旗を描かなくなる（ビーム本体は描かれないので符尾だけの裸の音符になる）。
  // 手順3 で作り直す前に、いったん全部の参照を外しておく。
  notes.forEach(note => clearBeam(note as StemmableNote));

  // 手順2: 拍の区切りを、またぎ位置でさらに分割する。
  // 束ねる対象にならなかった音符（4分音符など）は beatGroups に現れないので、
  // ここに出てこない音符は従来どおりビーム無しのまま。
  const fragments = beatGroups.flatMap(beam => {
    const indexes = beam.getNotes()
      .map(note => indexOfNote.get(note))
      .filter((index): index is number => index !== undefined);
    return splitIndexesByRenderTarget(indexes, renderPartIndexes);
  });

  // 手順3: 断片ごとに Beam を作り直す。1音だけの断片も generateBeams に通すのは、
  // 符幹の向きを「その断片の音符だけ」で決め直させるため（VexFlow は渡された
  // グループ単位で向きを揃える。またぎで別の五線へ行った音符の高さに引きずられない）。
  return fragments.flatMap(fragment =>
    Beam.generateBeams(fragment.map(index => notes[index]) as StemmableNote[], beamOptions)
  );
}
