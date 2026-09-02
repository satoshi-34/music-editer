# ペダル記号を再生に反映する — Issue #549

親: #468（再生の音楽性）。前提となる仕組み: #525（リリースの尻尾）/ `.claude/specs/playback-release-tail/design.md`、
表示側: `.claude/specs/pedal-bridge/design.md`。

## 問題

運用者の検聴（2026-09-01・月光検聴版）:「月光の左手の余韻が欲しい。ペダルの関係かな？」。

ペダル記号（Ped / ✱）は**描画済み**（#pedal-bridge）だが、**再生には一切反映されていなかった**。
実際のピアノでダンパーペダルを踏んでいる間は、鍵盤から指を離しても弦が鳴り続け、
小節をまたいで響きが重なる。月光第1楽章のような senza sordino の曲では、
この保持が無いと左手のオクターブが音価どおりに切れ、「伸びが足りない」印象になる。

#525 のリリースの尻尾（0.3〜0.6秒）は**ダンパーが降りる瞬間の自然さ**であり、
「ダンパーが上がったまま鳴り続ける」ペダルの保持とは別の機能。

## 修正設計

### 原則: 「切る側」だけを動かす（#525 と同じ）

ペダルで動かすのは**鳴り終わりの時刻だけ**。開始時刻・音価データ・小節送り・
ハイライト・終了タイマーは一切変更しない。したがってテンポ・リズム・
MusicXML/MIDI 書き出しには影響しない。

### データモデルは変えない

`NoteEvent.pedalMark: 'down' | 'up'` の単発マークのまま（#pedal-bridge の判断を踏襲）。
再生の直前に、描画と**同じペアリング規則**（`pedalBridgeUtils.pairPedalMarks`）で
down → up の区間を作る。ここで別のペアリングを書くと、破線の見た目と鳴り方が食い違う。

### 計画づくり（`src/utils/pedalPlaybackUtils.ts`・新規の純粋モジュール）

`buildPedalPlaybackPlans(parts, measureBeatsFloor)`:

1. 各パートの小節列を「絶対拍つきのイベント列」へ並べ直す。小節の進み方は
   再生エンジンと同じ **`max(内容の実長, 拍子ぶんの拍数)`**（タイの計画
   `tiePlaybackUtils` と同じ物差し。未充足小節がある譜面で位置がずれないため）
2. `pairPedalMarks` で区間 `{ downBeat, upBeat }` を作る。対応する ✱ が無い Ped は
   「譜面の終わりまで踏みっぱなし」（描画も単独 Ped として出るので見た目どおり）。
   踏む前の単独 ✱ は区間を作らない
3. **同じ楽器（instrumentKey）のパートの区間をまとめてから、その楽器の全パートへ適用する**。
   ペダルは楽器に1つなので、大譜表の左手側に置いた Ped. で右手の音も伸びるのが実機どおり
4. 区間内で発音した音について、キー（"e/4" 形式）ごとに
   「音価の後ろへ何拍足すか」= `解除位置 - 記譜どおりの鳴り終わり` を計画へ書く

戻り値は `Map<'小節:声部:イベント', Record<キー, 拍数>>`。キー生成はタイの計画
（`buildTiePlaybackEventKey`）を**再エクスポートして共用**する（同じ形のキーを
2か所で組み立てると、片方だけ直したときに静かにズレるため）。

#### 同音の再打鍵（仕様案4）

ペダル中でも、同じ高さの音を打ち直したら前の音はそこで切る（実ピアノでも同じ弦が
打ち直される）。台帳（鳴り続けている音の一覧）を持ち、新しい音の開始位置で
同じキーの古い音を切る。

#### 同時保持数の上限（仕様案5）

`MAX_PEDAL_HELD_NOTES_PER_PART = 24`。ペダルを長く踏んだままの曲では鳴り続ける音が
積み上がり、合計音量が振り切れて歪む（クリップ）。上限を超えたら**古い音から**
「新しい音が鳴り始めた位置」で解放する。実機でも響きが飽和して古い成分から
埋もれていくので、耳の印象としても近い。

### 各音源への配線

イベントに `pedalExtendBeatsByKey?: Record<string, number>`（`PlaybackEngine.ts`）を追加し、
**内蔵音源・SoundFont の両方**が同じ意味で使う。

```
鳴り終わり = max(記譜どおりの鳴り終わり（タイ・スタッカート込み）, ペダル解除位置)
```

- **掛け算ではなく max** を採る点がタイとの違い。スタッカート（`durationScale < 1`）でも
  ペダルを踏んでいれば響きは残るため、`durationScale` を掛けて短くしてはいけない
- 秒への換算は既存の `beatSpanToSeconds` + `tempoSegmentsFrom`（#458）を共用する。
  ペダルが次小節へまたぐとき、その先のテンポが違っても正しい長さになる
- **リリースの尻尾は二重実装しない**（仕様案2）。両音源とも「渡された長さ」から
  #525 の `resolveReleaseTailSeconds` で尻尾を付けるので、延長した長さを渡すだけで
  「解除位置まで鳴る → そこから減衰」になる
- **Safari 簡易経路**（`playSafariSafeVoice`）も同じ長さが流れるため、追加の分岐は不要
- **stopAll との整合**（仕様案3・受入3）: 新しい音源ノードを増やさないので、
  #525 で入った台帳登録・出力経路の世代交代がそのまま効く

### 画面側の配線（`ScorePage.tsx`）

- 強弱・テンポと同じく **反復展開後・途中再生で切る前の全列**で解決し、
  引くときに開始位置ぶんオフセットする（途中再生でも、開始位置より前で踏まれた
  ペダルを引き継ぐ）
- `instrumentKey` は `PlaybackPartSource.instrument`（編成譜のパート別音色）。
  ピアノ譜の右手・左手はどちらも `InstrumentType.PIANO` なので同じ楽器としてまとまる
- **トリルで展開された音にはペダル延長を付けない**。トリルは1音符を細かい連打へ割るため、
  サブ音符ごとに「音価の後ろへ N 拍」を足すと鳴り終わりがばらける
  （タイが付いた音をトリル展開しないのと同じ理由）

## 影響範囲

- `src/utils/pedalPlaybackUtils.ts`（新規・純粋関数）/ `src/utils/pedalPlaybackUtils.test.ts`（新規・11件）
- `src/audio/PlaybackEngine.ts`: `PlaybackMeasureEvent.pedalExtendBeatsByKey` を追加
- `src/audio/SoundFontEngine.ts`: 鳴り終わりを `max(タイ込みの長さ, ペダル解除位置)` に。
  併せて、タイ・ペダルが使うテンポ区間列をイベント内で1回だけ作るようにした（和音の音ごとに作り直さない）
- `src/audio/SimpleAudioEngine.ts`: 同上（`playScore` の引数型にも追加）
- `src/audio/pedalPlaybackEngines.test.ts`（新規・7件。両音源の契約）
- `src/components/ScorePage.tsx`: 計画の解決と配線
- `src/components/ScorePagePedalPlayback.test.tsx`（新規・1件。実マウントの配線テスト）
- 保存形式（JSON/MusicXML）・描画・拍計算は変更なし

## 受け入れ条件との対応

| 受入 | 対応 |
| --- | --- |
| 1. ペダル区間内の音が次の小節へ入っても鳴り続け、解除で減衰する | 両音源の予約長テスト（`pedalPlaybackEngines.test.ts`）。減衰は #525 の尻尾を共用 |
| 2. ペダル記号の無い譜面の再生は従来どおり | 記号が無ければ計画は空・`pedalExtendBeatsByKey` は付かない（`undefined`）。純粋関数と両音源の回帰テストで固定 |
| 3. 停止ボタンで保持中の音も即時止まる | 音源ノードを増やさないので #525 の stopAll がそのまま効く。内蔵音源で「保持中の音にも即時停止が予約される」ことをテスト |
| 4. ScorePage 配線テスト | `ScorePagePedalPlayback.test.tsx`（左手に置いた記号が右手の音にも効く） |

## 既知の制限（意図的に対応を見送った範囲）

- **ソステヌート／ウナコルダ**など他のペダルは対象外（記号自体が未実装）
- 文章指示（senza sordino 等）の自動解釈・「常時ペダル」再生オプションはスコープ外
  （Issue コメントの製品方針どおり）。再生はあくまで**譜面に書かれた記号どおり**
- **ハーフペダル・踏み替え（同じ位置での ✱ → Ped）**は表現できない。
  データモデルが単発マークのため、連続した Ped は前の区間をそこで終わらせる扱い
- トリルで展開された音は保持の対象外（上記）
- 同時保持数の上限は**パートごと**に数える（大譜表なら実質 24×2）。
  楽器全体で数える形にはしていない
- 内蔵音源は元から和音の先頭音のみを鳴らす仕様のため、保持も先頭音だけに効く


## 追補（round1/2 レビュー対応・2026-09-02）

- **ペアリングは楽器単位で一度だけ**: 段ごとに pairPedalMarks してから区間統合する旧手順は
  「左手 Ped+右手 ✱」がペアにならない（round1 P1）。生マークを pedalGroup 単位で集約→
  sort→一度だけ pairPedalMarks へ。
- **共有単位は pedalGroup**（音色 InstrumentType ではない・round1 P2）: piano=両手 /
  ensemble=同一パートの大譜表2段のみ / quartet・single=パートごと。同音色の別楽器
  （ピアノ2台等）へは漏れない。
- **踏み替え**: 区間を downBeat 順に隣接クリップ（upBeat=min(upBeat, 次のdownBeat)）。
  連続 Ped・リピート展開で Ped が並ぶ場合も後続の ✱ が効く（round1 P2）。
- **単独 Ped の終端**は小節送りを含む再生タイムライン終端（buildTimeline の totalBeats を
  楽器内で max）。段の最終イベントではない（round1 P2）。
- **タイの継続音は再打鍵ではない**: arcs kind='tie' の toKey と旧 tiedToNext を
  planKey→Set<key> で記録し、再打鍵 release から除外（round1 P1）。
  **リピート展開後は arc.toMeasureIndex（元小節番号）を tiePlaybackUtils の
  resolveTargetExpandedIndex で「この出現から見た正しい出現」へ解決**してからキーを作る
  （round2 P1）。このため計画の入力は sourceMeasureIndex 付きの展開項目も受ける。
