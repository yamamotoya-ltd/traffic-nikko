# （仮）日光 渋滞ラジオ — 試作版（ステップA）

日光で渋滞にはまった人が、その時間を「日光を好きになる時間」に変えるためのWebアプリです。
運転手は音声で聞き、同乗者が画面で操作します。インストールや会員登録はいりません。

## できること

| 画面 | 中身 |
|---|---|
| 最初の画面 | 「同乗者の方が操作してください」の表示。位置情報か、手動（今市／東武日光駅前／神橋）で場所を選ぶ |
| 聞く | テーマの順（自然の成り立ち → 歴史 → 暮らし）に話が並び、今いる場所の話が一番上に来る。1回押すと続けて流れる |
| 次に来るなら | 地元の人がすすめる、混まない時期・時間・場所。「保存（LINE）」「カレンダーに入れる」ボタン |
| 渋滞のコツ | オフピーク、有料道路、公共交通、行政サイトへのリンク |
| 最後の画面 | アンケート3問、LINE友だち登録、メール登録（同意のチェックつき） |

- 話を1本聞き終わるたびに、関連する「次に来るなら」を1枚出す
- 音声ファイルがない話は、スマホの読み上げ機能で流す（試作用）
- 音声が流れないときは、原稿の文章を表示する
- 一度開くと画面のファイルをスマホに保存するので、電波が弱くても動く

## ファイルの場所

| ファイル | 役割 |
|---|---|
| `public/` | **公開されるファイルはすべてここ**。これ以外（README・道具など）は公開されない |
| `public/data/content.json` | **中身の台帳**。話・おすすめ・話し手・コツ・設定（サービス名、LINEのIDなど） |
| `public/audio/` | 話の音声ファイル（MP3）。`public/audio/<話のID>.mp3` |
| `public/index.html` / `styles.css` / `app.js` | 画面と動き |
| `public/sw.js` | 電波が弱いとき用の保存の仕組み |
| `wrangler.jsonc` | Cloudflare に公開するための設定 |
| `tools/generate-audio.mjs` | 原稿を Google の音声サービスで MP3 にする道具 |
| `public/rules.html` / `privacy.html` | 掲載ルール／プライバシーポリシー（下書き） |

## パソコンで試す

```bash
python3 -m http.server 8000 --directory public
```

ブラウザで http://localhost:8000 を開きます。

## 中身を変える

`public/data/content.json` を書き換えます。今入っている話・話し手・おすすめは、すべて **試作用の仮のもの** です。

- サービス名：`config.serviceName`（ほかに `public/index.html` の `<title>` と `public/manifest.webmanifest` も合わせて変える）
- LINE公式アカウントができたら：`config.lineOaId`（例 `@abc1234`）と `config.lineAddFriendUrl`
- メール登録フォーム（Googleフォーム）ができたら：`config.emailFormUrl`
- 行政のリアルタイム渋滞情報のURLが決まったら：`config.trafficInfoUrl`（「渋滞のコツ」の一番上に大きなボタンが出る）

将来は、Googleスプレッドシートの台帳から、この `content.json` を作る形にする予定です。

## 公開する（Cloudflare）

試作版のあいだは、**検索エンジンに載せない設定**（`public/_headers`・`public/robots.txt`・各ページの `noindex`）にしてあり、画面の一番上に「試作版」と表示しています。URLを知っている人だけが見られる状態です。

### 最初の1回だけ（福田さんのCloudflareアカウントで行う）

1. Cloudflare のダッシュボードにログインする（ウラカタのカレンダーと同じアカウント）
2. 左のメニューの「Workers & Pages」（または「Compute」）→「作成（Create）」を押す
3. 「リポジトリをインポート（Import a repository）」を選び、GitHub とつなぐ
   - 初めてのときは、GitHub 側で「Cloudflare」アプリを `yamamotoya-ltd` に入れる画面が出ます。対象は `traffic-nikko` だけにします
4. リポジトリ `yamamotoya-ltd/traffic-nikko` を選ぶ
5. 設定はこのとおりにする
   - プロジェクト名：`traffic-nikko`
   - ビルドコマンド（Build command）：空のまま
   - デプロイコマンド（Deploy command）：`npx wrangler deploy`
   - 公開するブランチ（Production branch）：`claude/epic-sagan-uwnc9k`（今はこのブランチしかないため）
6. 「デプロイ（Deploy）」を押す
7. 数分で `https://traffic-nikko.（アカウント名）.workers.dev` のようなURLができる

### 2回目から

上のブランチに変更を送る（push）と、**自動で公開し直されます**。Cloudflareの画面を開く必要はありません。

※自動なので、送った変更はそのまま公開されます。中身を変えたら、まずパソコンで確認してから送ってください。

### 本番（GW）で検索に出したくなったら

`public/_headers` と `public/robots.txt` を消し、各ページの `<meta name="robots" ...>` の行と「試作版」の表示を消します。

## 音声を作る（Google Cloud Text-to-Speech）

1. 確認だけ（お金はかかりません）：
   ```bash
   node tools/generate-audio.mjs --dry-run
   ```
2. Google Cloud 側の準備（福田さん側の作業。支払い設定が必要）
   - Google Cloud でプロジェクトを作り、支払い情報を登録する
   - 「Cloud Text-to-Speech API」を有効にする
   - 「APIキー」を作り、使えるAPIを Text-to-Speech だけに制限する
3. 音声を作る：
   ```bash
   GOOGLE_TTS_API_KEY=（キー） node tools/generate-audio.mjs
   ```
   できたMP3は `public/audio/` に入り、`content.json` の `audio` 欄が自動で書き込まれます。
   声を変えるときは、話し手に `"ttsVoice": "ja-JP-Neural2-C"` のように書きます。
4. 肉声に差し替えるときは、同じ名前のMP3を入れ替えるだけです。

※APIキーは、リポジトリに書き込まないでください。

## まだやっていないこと（試作の範囲外）

- インターネットへの公開
- LINE公式アカウント・メール登録フォーム・アンケート送信先とのつなぎ込み（今はスマホの中に記録するだけ）
- アクセス解析（今は `track()` がスマホの中に記録するだけ。あとで Google アナリティクスなどにつなぐ）
- スプレッドシート台帳との連携
- 冒頭と締めの肉声と、AI音声をつなげる作業

## 実車テストで確かめること

- iPhone で画面を消したとき、2本目以降が続けて流れるか
- 読み上げ／音声の音量ボタンが効くか（iPhoneは本体の音量ボタンしか効かない場合がある）
- 電波が弱い場所で止まらないか
