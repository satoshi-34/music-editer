# 要件定義書

## 概要

音楽エディターアプリケーションに和音（コード）機能を追加する。現在は1つの音符イベントに1つの音高（`key: string`）しか持てない単音構造になっているが、複数の音高を同時に保持・表示・再生できるよう拡張する。ユーザーは既存の音符入力操作を拡張した形で和音を入力でき、譜面上に正しく表示され、再生時には複数の音が同時に鳴る。

## 用語集

- **Chord**: 2つ以上の音高を同時に鳴らす和音。本機能の中心概念
- **Chord_Note**: 和音を構成する個々の音高（例: C4, E4, G4）
- **Note_Event**: 1つの音符イベント。単音の場合は `keys` に1要素、和音の場合は複数要素を持つ
- **Chord_Input_Mode**: 和音入力モード。既存の音符に音高を追加するモード
- **Staff_Canvas**: 五線譜を描画・操作するキャンバスコンポーネント
- **Piano_System_Canvas**: N段譜表を描画するキャンバスコンポーネント
- **Note_Player**: 個別音符・和音の再生を担当するモジュール
- **Score_Player**: 譜面全体の再生を担当するモジュール
- **VexFlow**: 楽譜レンダリングライブラリ
- **Tone_js**: Web Audio APIラッパーライブラリ（音声合成に使用）
- **Storage**: LocalStorageを使った譜面データの永続化層

## 要件

### 要件1: データモデルの拡張

**ユーザーストーリー:** 音楽制作者として、1つの音符イベントに複数の音高を持たせたい。これにより、和音を楽譜データとして正しく表現・保存できる。

#### 受け入れ基準

1. THE Note_Event SHALL `keys` フィールド（文字列の配列）を持ち、単音の場合は1要素、和音の場合は2要素以上を格納する
2. WHEN 既存の単音データ（`key: string` 形式）を読み込む場合 THEN Storage SHALL そのデータを `keys: [key]` 形式に自動変換して後方互換性を維持する
3. THE Note_Event SHALL `keys` 配列の各要素を VexFlow 形式（例: `"c/4"`, `"f#/3"`）で格納する
4. WHEN `keys` 配列が空の場合 THEN Staff_Canvas SHALL その Note_Event を無効として扱い描画をスキップする
5. FOR ALL Note_Event データ、シリアライズしてデシリアライズした結果は元のデータと等価でなければならない（ラウンドトリップ特性）

### 要件2: 和音入力

**ユーザーストーリー:** 音楽制作者として、既存の音符に音高を追加して和音を作りたい。これにより、コードやハーモニーを楽譜に記入できる。

#### 受け入れ基準

1. WHEN ユーザーが音符を選択した状態で五線譜上の別の位置をクリック THEN Staff_Canvas SHALL 選択中の Note_Event の `keys` 配列に新しい音高を追加する
2. WHEN 和音に追加する音高が既存の `keys` 配列内に既に存在する場合 THEN Staff_Canvas SHALL その音高を追加せず重複を防ぐ
3. WHEN 和音の音高数が8を超える場合 THEN Staff_Canvas SHALL 追加を拒否してユーザーに通知する
4. WHEN ユーザーが選択中の音符の既存音高をクリック THEN Staff_Canvas SHALL その音高を `keys` 配列から削除する（ただし最後の1音は削除しない）
5. WHILE 和音入力モードが有効 THEN Staff_Canvas SHALL ガイドラインを表示して追加先の音高を視覚的に示す

### 要件3: 和音の表示

**ユーザーストーリー:** 音楽制作者として、和音を楽譜上に正しく表示したい。これにより、入力した和音の内容を視覚的に確認できる。

#### 受け入れ基準

1. WHEN Note_Event の `keys` 配列が2要素以上の場合 THEN Staff_Canvas SHALL VexFlow の `StaveNote` に複数の `keys` を渡して和音として描画する
2. WHEN 和音に臨時記号（#/b）を含む音高がある場合 THEN Staff_Canvas SHALL 各音高に対して正しい臨時記号を付与して描画する
3. WHEN 和音が選択された場合 THEN Staff_Canvas SHALL 和音を構成するすべての符頭を選択色（青）でハイライトする
4. WHEN 和音の音高が五線の外（加線域）に及ぶ場合 THEN Staff_Canvas SHALL 加線を正しく描画する
5. THE Staff_Canvas SHALL 和音の符頭が重なる場合（2度音程など）に VexFlow の標準的な符頭ずらし（offset）を適用して描画する

### 要件4: 和音の再生

**ユーザーストーリー:** 音楽制作者として、入力した和音を実際に音として確認したい。これにより、ハーモニーが意図通りかを耳で確認できる。

#### 受け入れ基準

1. WHEN ユーザーが和音の音符をクリック THEN Note_Player SHALL `keys` 配列のすべての音高を同時に再生する
2. WHEN 譜面全体を再生中に和音に到達 THEN Score_Player SHALL 和音を構成するすべての音高を同時に再生する
3. WHEN 和音を再生する場合 THEN Note_Player SHALL すべての Chord_Note を同一の開始時刻（`time`）でスケジュールする
4. WHEN 和音の再生が終了する場合 THEN Note_Player SHALL すべての Chord_Note を同時に停止する
5. WHEN 和音を含む譜面を再生中に停止ボタンが押された場合 THEN Score_Player SHALL 再生中のすべての Chord_Note を即座に停止する

### 要件5: 和音の編集

**ユーザーストーリー:** 音楽制作者として、入力済みの和音を修正したい。これにより、誤った音高を修正したり、和音の構成を変更したりできる。

#### 受け入れ基準

1. WHEN 和音が選択された状態でキーボードの↑/↓キーを押下 THEN Staff_Canvas SHALL 和音を構成するすべての音高を同じ方向に1段（0.5行）移動する
2. WHEN 和音が選択された状態でShift+↑/↓キーを押下 THEN Staff_Canvas SHALL 和音を構成するすべての音高を1オクターブ移動する
3. WHEN 和音が選択された状態でAlt+↑/↓キーを押下 THEN Staff_Canvas SHALL 和音を構成するすべての音高を半音移動する
4. WHEN 和音が選択された状態でDeleteキーを押下 THEN Staff_Canvas SHALL 和音全体（Note_Event ごと）を削除する
5. WHEN 和音が選択された状態でEscapeキーを押下 THEN Staff_Canvas SHALL 選択を解除する

### 要件6: 保存・読み込みの互換性

**ユーザーストーリー:** 音楽制作者として、和音を含む譜面を保存・読み込みしたい。これにより、作業を中断・再開しても和音データが失われない。

#### 受け入れ基準

1. WHEN 和音を含む譜面を保存 THEN Storage SHALL `keys` 配列を含む Note_Event を JSON 形式で LocalStorage に正しく保存する
2. WHEN 保存済みの和音データを読み込む THEN Storage SHALL `keys` 配列を正しく復元して和音として表示する
3. WHEN 旧形式（`key: string`）のデータを読み込む THEN Storage SHALL `key` を `keys: [key]` に変換して後方互換性を維持する
4. WHEN 保存データが破損している場合 THEN Storage SHALL エラーをログに記録してデフォルトの空譜面を表示する
5. FOR ALL 有効な SavedScoreData、保存してから読み込んだ結果は元のデータと等価でなければならない（ラウンドトリップ特性）

### 要件7: 複数パートでの和音対応

**ユーザーストーリー:** 音楽制作者として、ピアノ大譜表や弦楽四重奏の各パートでも和音を入力したい。これにより、すべての譜表形式で和音を使用できる。

#### 受け入れ基準

1. THE Piano_System_Canvas SHALL 単旋律・ピアノ大譜表・弦楽四重奏のすべての譜表形式で和音入力・表示・再生をサポートする
2. WHEN ピアノ大譜表の右手パートに和音を入力 THEN Piano_System_Canvas SHALL 右手パートのみに和音を追加し左手パートに影響しない
3. WHEN 弦楽四重奏の任意のパートに和音を入力 THEN Piano_System_Canvas SHALL そのパートのみに和音を追加し他のパートに影響しない
4. WHEN 複数パートが同時刻に和音を持つ場合 THEN Score_Player SHALL すべてのパートの和音を同時に再生する
5. WHEN 複数パートの和音を含む譜面を保存・読み込み THEN Storage SHALL 各パートの和音データを独立して正しく保存・復元する

### 要件8: エラーハンドリング

**ユーザーストーリー:** システム管理者として、和音機能に関するエラーを適切に処理したい。これにより、エラー発生時でもアプリケーションが安定して動作する。

#### 受け入れ基準

1. IF `keys` 配列に無効な音高文字列が含まれる場合 THEN Staff_Canvas SHALL その音高をスキップして残りの有効な音高のみを描画する
2. IF 和音の再生中に音声エラーが発生 THEN Note_Player SHALL エラーをログに記録して再生を安全に停止する
3. IF VexFlow が和音の描画に失敗 THEN Staff_Canvas SHALL エラーをログに記録して単音フォールバック描画を試みる
4. IF 和音データのデシリアライズに失敗 THEN Storage SHALL エラーをログに記録して該当 Note_Event を空の休符として扱う
5. WHEN 和音入力中にブラウザの音声コンテキストが中断 THEN Note_Player SHALL 自動復旧を試行してユーザーに通知する
