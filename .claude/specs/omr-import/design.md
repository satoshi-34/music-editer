# PDF楽譜の取り込み（OMR 変換サーバ経由）設計書

対象 Issue: #487（#461 段1）
初版: 2026-08-29

## 1. 背景と方式決定

紙・PDFの楽譜を本アプリで編集したい、という要望（#461）に対し、
2026-08-29 のスパイクで3経路を比較した（詳細は #461 のコメント）。

| 経路 | 結果 | 判定 |
| --- | --- | --- |
| Audiveris 5.11（Java・AGPL） | 浄書PDFで69小節・調号・音高が正解と一致。3ページ26秒。出力 .mxl が本アプリでそのまま開けた | ◎ 採用 |
| oemer（Python・MIT） | 1ページ2.6分。リズムが崩壊し実用外 | ✕ |
| VLM に画像を直接読ませる | 小節単位なら高精度だが、一括変換にはコスト高 | △ 後続の「修正層」で補助的に使う |

出版譜スキャンでは弱点が2つある（1段目の左手ヘ音記号の検出漏れ／三連符マーカーの欠落）。
つまり**完成品ではなく「修正前提の下書き」**であり、UI上も β として提示する。

方式: **Audiveris を変換サーバ（コンテナ）に閉じ込め、アプリは HTTP で呼ぶだけ**にする。

```
アプリ（「PDF (β)」ボタン）
   │  POST /convert （multipart: PDF）
   ▼
変換API コンテナ  server/omr
   │  Audiveris CLI を子プロセスで実行（-batch -export）
   ▼
 .mxl（圧縮MusicXML）
   │
   ▼
既存の MusicXML 読込経路（mxlUtils → musicXmlImport）
```

## 2. AGPL の整理（なぜこの構成なのか）

Audiveris は AGPL v3。本体アプリをクローズドソースのまま提供する前提のため、
以下を**設計上の制約**として固定する。

- Audiveris は**公式配布のバイナリ（.deb）を無改造のまま**コンテナへ入れる
- 呼び出しは**別プロセスの起動（CLI）と HTTP** に限る。ライブラリとしてリンクしない・
  ソースを取り込まない・パッチを当てない
- Audiveris に手を入れる必要が出た場合は、実装せずに Issue へ差し戻す（判断を人に返す）

※ AGPL の「ネットワーク越しの利用者へのソース提供義務」は Audiveris 本体（無改造）に関する
ものであり、公開時には配布元と版を明示できる状態にしておく（`AUDIVERIS_VERSION` を Dockerfile の
ARG にしているのはこのため）。

## 3. 変換API（server/omr）

| ファイル | 役割 |
| --- | --- |
| `Dockerfile` | ubuntu 24.04 + Audiveris 5.11.0 の公式 .deb（Java 21 同梱）+ Node（薄いラッパー） |
| `server.js` | HTTP 層（`POST /convert`・`GET /health`・CORS） |
| `convert.js` | multipart 解析・入力上限・理由コード（**依存ゼロ・単体テスト対象**） |
| `audiveris.js` | Audiveris の子プロセス実行・一時ファイルの後始末 |

### API

- `POST /convert`（`multipart/form-data`, フィールド名 `file`）→ 成功時 `200` で .mxl のバイト列
  （`content-type: application/vnd.recordare.musicxml`）
- 失敗時は `{ "error": { "reason": ..., "message": ... } }`（#318: 黙って失敗しない）

| reason | HTTP | 意味 |
| --- | --- | --- |
| `noFile` | 400 | multipart に PDF が入っていない |
| `notPdf` | 400 | 中身が PDF でない（先頭が `%PDF-` でない） |
| `tooLarge` | 413 | 20MB 超 |
| `tooManyPages` | 413 | 20ページ超 |
| `timeout` | 504 | 120秒以内に終わらなかった |
| `conversionFailed` | 422 | Audiveris が異常終了 |
| `noOutput` | 422 | 変換は終わったが .mxl が出てこなかった（譜面として読めなかった） |

### 設計上の判断

- **依存パッケージを入れない**: multipart の解析は「PDFが1つ入っているだけ」の用途に絞った
  最小実装（`convert.js`）にした。express/busboy を足すと、変換サーバ側にも依存更新の運用が
  発生するため（アプリ本体の依存追加ルールと同じ考え方）
- **ページ上限は二段構え**（round1 P1）: 入口の `countPdfPages`（非圧縮の `/Type /Page` を数える
  簡易カウント）は安価な足切りで、オブジェクトストリームで圧縮された PDF は数えられず素通しする。
  そこで**確定判定は変換直前の `pdfinfo`**（poppler-utils・無改造バイナリの子プロセス起動のみ＝
  Audiveris と同じプロセス分離）が必ず行う（`audiveris.js` の `assertPageCountWithPdfinfo`）。
  pdfinfo が使えない・出力を読めない場合は fail-closed（`conversionFailed`）で変換に進まない。
  Dockerfile には poppler-utils を追加してある
- **上限超過でも理由コードを届ける**（round1 P1）: 受信中に `req.destroy()` すると 413 の JSON を
  返す前に接続が切れるため、上限超過時はバッファを捨てて読み流し、レスポンス送信完了後に
  接続を閉じる。`Content-Length` が申告されていれば受信前に 413 で断る。
  テストできるように `createOmrServer()`（listen しない工場関数）へ分離し、直接実行時のみ待ち受ける
- **multipart の境界は正式な境界行のみ**（round1 P2）: PDF はバイナリなので本文中に `--境界` と
  同じバイト列が現れうる。本文先頭か CRLF 直後にあり、直後が CRLF か `--` のものだけを区切りとする
- **一時ファイルは必ず消す**: 入力PDFと出力 .mxl は `mkdtemp` の作業ディレクトリに置き、
  成功・失敗にかかわらず `finally` で削除する（ユーザーの楽譜をサーバーに残さない）
- **実行ファイルのパスを決め打ちしない**: .deb の配置はパッケージの作り方で変わるため、
  ビルド時に `find` で探して `/usr/local/bin/audiveris` へ symlink する
- **非 root で動かす**（ubuntu イメージ既定の `ubuntu` ユーザー）

## 4. アプリ側

- `src/utils/omrApi.ts`: 変換APIのクライアント。`VITE_OMR_API_URL` が未設定なら `getOmrApiUrl()` が
  `null` を返し、**「PDF (β)」ボタンも隠しファイル入力も描画しない**（本番は当面非表示のまま）
- `src/components/ScorePage.tsx`:
  - 既存の `handleImportMusicXml` の中身を **`applyImportedMusicXmlBytes(bytes, fileName)` へ抽出**し、
    ファイル選択経路と PDF変換経路の**両方が同じ読込処理を通る**ようにした。
    経路ごとに読込処理を書くと片方だけ直る事故（#280 の型）になるため、新しいパース処理は書かない
  - `handleImportPdf`: 変換API → 返ってきた .mxl を `applyImportedMusicXmlBytes` へ渡す。
    変換中はボタンを「PDF 変換中…」にして無効化（数十秒かかるため、二重送信も防ぐ）
- `src/utils/scoreEditorNotices.ts`: `describeOmrConvertFailed(reason)` を追加。
  **失敗時は必ず理由＋代替手順（Audiveris で手元変換 →「MusicXML (.mxl)」で開く）**を出す

## 5. テスト

| テスト | 内容 |
| --- | --- |
| `server/omr/convert.test.js` | 正常系（multipart から PDF を取り出す）・上限超過（tooLarge / tooManyPages）・壊れたPDF（notPdf）・入口の簡易カウントで数えられないPDFを入口では弾かないこと（確定判定は pdfinfo 側）・PDF本文中の境界と同じバイト列で切断しないこと |
| `server/omr/audiveris.test.js` | spawn モックで子プロセスの約束を固定: 成功・異常終了・タイムアウト時の SIGKILL・pdfinfo のページ上限確定判定（超過時は Audiveris を起動しない）・一時ディレクトリを成功失敗問わず消すこと |
| `server/omr/server.test.js` | 実HTTPで配線を固定: 上限超過でも理由コード付き 413 JSON が届くこと（Content-Length 事前拒否 / chunked 受信中の打ち切りの両方）・maxPdfBytes 指定が PDF 本体の上限にも効くこと・CORS・正常系・OPTIONS / health / 404 |
| `src/utils/omrApi.test.ts` | fetch モックで送信先/形式、失敗レスポンスの理由コードの持ち上げ、URL 未設定時に通信しないこと |
| `src/components/ScorePagePdfImport.test.tsx` | ScorePage の配線: URL 未設定ならボタンを出さない／PDF を選ぶと変換APIへ送り、返った .mxl が画面へ反映される／失敗時は理由と代替手順を通知し譜面を変えない |
| `src/components/ScorePageFileOpenWiring.test.tsx` | 「開く」ボタン群と隠し input の配線（#464）。**変換APIの設定あり/なしの両方**を固定する（#587） |

### テストは環境変数を暗黙に読まない（Issue #587・2026-09-03）

`VITE_OMR_API_URL` は「設定されていれば PDF 用の隠し input と『PDF (β)』ボタンが増える」という
**画面の構造を変える**設定なので、環境変数を stub せずに書いたテストは
**`.env.local` を置いている開発環境だけ落ちる**。実際に
`ScorePageFileOpenWiring.test.tsx` の「input が2つ」の期待が開発環境でだけ
`expected 3 to be 2` で落ちた（CI は環境変数が無いため緑のまま＝気づきにくい形）。

したがってこの設定に触れるテストは、**必ず `vi.stubEnv` で明示する**（`afterEach` の
`vi.unstubAllEnvs()` とセット）。未設定を表したいときは空文字を渡せばよい
（`getOmrApiUrl` は空文字を null と解釈するため、未設定と同じ扱いになる）。

棚卸しの結果（#587 時点）:

| テスト | 状態 |
| --- | --- |
| `ScorePageFileOpenWiring.test.tsx` | **これだけが暗黙依存だった** → 未設定を stub、加えて設定ありのケースを追加して両方を固定 |
| `ScorePagePdfImport.test.tsx` / `omrApi.test.ts` | 以前から各ケースで明示的に stub 済み（`VITE_OMR_API_TOKEN` も両方向を固定）。変更不要 |
| ほかの隠し input を使うテスト（`ScorePageMxlImport` / `MusicXmlDefaults` / `MusicXmlPedal` / `DynamicsImportNotice` / `MusicXmlRepeatedAttributes` / `TempoExportWiring` / `PartLayout` / `LayerSlice` / `MusicXmlGrandStaff`） | いずれも **`accept` の内容で input を探している**（本数や並び順に依存しない）ため、PDF 用が増えても結果が変わらない。変更不要 |

## 6. 影響範囲

- 既存の MusicXML / .mxl 読込は `applyImportedMusicXmlBytes` への抽出のみで、**挙動は変えていない**
  （`ScorePageMxlImport.test.tsx` が回帰の見張り役）
- 変換API を使わない環境（= 本番）では、UI もネットワークアクセスも一切増えない
- ローカルで使う場合:
  ```sh
  docker compose --profile omr up omr          # 変換APIを 127.0.0.1:8080 で起動
  VITE_OMR_API_URL=http://localhost:8080 npm run dev
  ```

## 6.5 公開時の防護と脅威モデル（Issue #493・運用者合意 2026-08-30）

### 試用公開の構成（商用化前は GCP 課金を発生させない）

- 変換サーバーは **Air（常設ランナー機）上の docker** で動かし、**Cloudflare Tunnel（無料）**で
  外向けURLを作る（自宅ポートは開けない）。x86_64 コンテナのため M1 ではエミュレーション実行で
  変換が遅くなるのは試用の割り切り
- アプリ側の `VITE_OMR_API_URL` / `VITE_OMR_API_TOKEN` は **Vercel のプレビュー環境にのみ**設定し、
  本番バンドルには PDF (β) ボタンもトークンも一切載せない。試用者は運用者と発案者ユーザーのみ
- 商用化時に工場部分だけ Cloud Run（東京・max-instances=1・予算アラート2段）へ差し替える。
  アプリ・通知・テストは変更不要（エンジン非依存の /convert 契約）

### 共有トークン検査（この設計の防護）

- サーバー: `OMR_API_TOKEN` 設定時のみ `x-omr-token` ヘッダの一致を要求。不一致は**受信・変換前に
  401 + reason: unauthorized**（#318）。比較は timingSafeEqual（比較時間からの推測防止）。
  未設定なら検査なし＝ローカル開発の従来挙動
- 役割分担: **CORS はブラウザ経由の他サイト対策、トークンは curl 等の直接叩き対策**。
  トークンはビルド成果物から掘り出せる前提の「立入禁止の札」であり、鍵ではない
- CORS を対策として成立させるため、試用公開時は `OMR_ALLOWED_ORIGIN` を**ブランチ固定の
  プレビューオリジンに絞る**（compose でパススルー・手順は README）。未設定の `*` は
  ローカル開発専用（round1 P3）

### 脅威モデル（何を守り、何を割り切るか）

| シナリオ | 防護 | 割り切り |
| --- | --- | --- |
| URLだけ見つけた bot | 401 で変換前に拒否（コストほぼゼロ） | — |
| バンドルからトークンを掘った攻撃者 | 同時実行上限で課金速度に天井・予算アラートで数日内に検知・トークン差し替え（数分）で締め出し | 検知までの少額課金は受容 |
| 細工PDFでのコンテナ侵害 | 非root・データレス（楽譜は必ず削除・DB接続なし）の使い捨てコンテナ | 侵害されても被害は課金シナリオに縮退 |
| 枠の占有（可用性DoS） | — | 失敗通知が代替手順（手元Audiveris）を必ず案内するため行き止まりにならない |

- **ハードキャップ不在の受容理由**: GCP に「上限で自動停止」は無い（予算は通知のみ）。
  代わりに「燃える速度の上限（同時実行1）＋早期検知（アラート）＋数分での締め出し（トークン差替）」
  で実質同等の安全性とする。Vercel 側は Hobby=停止のみ（課金なし）、Pro=Spend Management あり

### 商用化後の発展（今回は設計記録のみ・実装しない）

- **短命トークン方式**: Vercel の発行関数が数分で失効する署名付きトークンを発行し、秘密鍵を
  ブラウザに配らない。発行時にログイン＋プラン判定を行い、**無料プランは1日5回等のクォータ、
  課金プランは拡大**（カウンタは Neon に1テーブル）。発行レート制限（例: 全体で10秒に1枚）で
  課金攻撃の天井を発行口側にも作る
- Vercel Hobby は規約上商用利用不可のため、商用化時に Pro へ移行（商用化前タスク一覧に記録済み）

## 7. 本Issueの範囲外（後続）

- Cloud Run 等へのデプロイ（レビュアーが手動で実施）
- クレフ誤検出・連符欠落の自動補正（「修正層」。拍不整合の検出→VLM で該当小節を再読→修正提案）
- 変換の進捗表示（現状は「変換中…」のみ。Audiveris はページ単位の進捗を出せるが、
  ストリーミングAPIが必要になるため見送り）

## 8. 未検証事項（2026-08-29 時点）

- **コンテナイメージのビルドは未実行**。作業機から Docker Hub の `ubuntu:24.04` を取得できず
  （`DeadlineExceeded`）、`docker build` を完走できなかった。.deb の URL と資産名は
  GitHub Releases API で実在を確認済み（`Audiveris-5.11.0-ubuntu24.04-x86_64.deb`）だが、
  **Audiveris の起動確認・実PDFのエンドツーエンド変換は未実施**。最初に動かす人は
  `docker compose --profile omr build omr` の完走と `/health` の応答から確認すること
