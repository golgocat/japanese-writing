# Japanese Writing MCP

Japanese Writingの執筆ルールと文字数計測を、Google認証付きのリモートMCPとして提供する。文章生成は接続先のAIが担当する。サーバーからモデルAPIを呼ばず、入力された文章を保存しない。

## 状態

SAT-228。Cloudflare Workers向けの実装。公開、実Googleログイン、Grok Botでの接続確認は未実施。ローカルでGoogleの応答を模擬した検証と、実アカウントでの接続確認を区別する。

## 提供機能

| 機能 | 内容 |
| --- | --- |
| `list_skills` | 利用できるスキルと配信中の内容ハッシュ |
| `get_writing_guidance` | 操作・用途に応じた共通ルールと参照資料 |
| `read_writing_reference` | 許可リストにある参照ファイルの読取 |
| `count_characters` | コードポイント・書記素・UTF-16・UTF-8バイト数の計測 |
| Resources | `skill://japanese-writing/SKILL.md`など公開スキルの10文書 |
| Prompt | `japanese-writing`。Prompts非対応クライアントは同等のToolsを使用 |

MCP SDK v2のStreamable HTTPと、2025年版のステートレス互換経路を使う。旧HTTP+SSE専用クライアントは対象外。クライアントがMCPを追加しただけで執筆ルールを必ず採用するとは限らないため、下記の利用指示も設定する。

## 認証と利用権限

接続の流れは、MCPクライアント → 本サービスのOAuth → Googleログイン → クライアントへの利用同意 → 本サービスのアクセストークン → MCP。

- Googleの権限は`openid email`のみ。Googleのaccess tokenやrefresh tokenをMCPクライアントへ渡さず、保存もしない。
- Google ID tokenの署名、issuer、audience、有効期限、発行時刻、nonce、email_verified、必要ならazpを検証する。
- 初回の所有者は`OWNER_EMAIL`に設定したメールアドレスで認証する。メールは公開設定に書かず、Cloudflare Secretまたはローカルの保護ファイルに置く。
- アカウントをGoogleの不変`sub`に結び付ける。一度結び付いた招待メールを、別のGoogleアカウントが引き継いで利用することはできない。
- D1のmembersで招待・利用停止・スキル権限を管理し、MCPアクセス時とtoken更新時にも確認する。利用停止を古いトークンで迂回できない。
- MCPのresource/audience、PKCE S256、登録済みredirect URIを検証する。Google stateと同意はブラウザーCookieに結び付け、D1で一度だけ消費する。
- 同意画面にはクライアント名と戻り先を表示する。クライアント名は申告情報として扱い、無条件で信頼しない。
- OAuth stateは10分で失効し、新規state作成時に期限切れの記録を削除する。アクセストークンは15分、refresh tokenと動的client登録は30日。
- IP別にOAuth操作を毎分60回、client登録を毎分10回、利用者別にMCP要求を毎分120回に制限する。IPは時間帯付きハッシュキーとして一時利用する。これらはアプリ側の制限であり、Cloudflare料金の強制上限ではない。
- Browser Origin付きのMCP要求は同一origin、または`MCP_BROWSER_ORIGINS`で指定した完全一致のoriginだけを許可する。通常のサーバー型MCPクライアントはOriginなしで接続できる。

未認証で公開するのは、接続案内、health、OAuth discovery、認証・登録の入口。スキルのTools/Resources/Promptsは認証必須。公開GitHubリポジトリにある元文書自体の公開範囲は変わらない。

## ローカル開発

Node.js 22.23.2で確認。依存関係はlockfileとexactバージョンで固定する。

```sh
cd mcp
npm ci
npm run check
npm run build
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
npm run db:migrate
npm run dev
```

`.dev.vars`へ専用Google Webアプリ用のclient ID/secretと所有者メールを入力する。チャット、git、コマンド引数へ秘密値を貼らない。Google Workspace CLIや他アプリのOAuth資格情報を流用しない。

Google側に登録するローカルredirect URIは`http://localhost:18787/oauth/google/callback`。MCP endpointは`http://localhost:18787/mcp`。Originを持つブラウザークライアントを使う場合は、その実際のoriginを`MCP_BROWSER_ORIGINS`へJSON配列で指定する。

Google設定がない状態でも模擬テストは実行できる。テストの偽Google鍵や応答を使う経路はテストプロセス内だけにあり、本番コードに認証バイパスはない。

## 配信するスキル

`npm run bundle`が親ディレクトリの`SKILL.md`と指定した参照ファイルだけをビルドへ取り込む。ユーザー入力からパスやURLを組み立てず、ローカルの私有スキルや任意ファイルは読み出さない。

内容の変更はGitHubでレビューし、承認済みのデプロイで反映する。実行中にmainを毎回取り込む方式ではない。`list_skills`の`version`は文書内容のSHA-256、`sourceCommit`はビルド元のコミット。文字数ロジックは既存CLIと共通化している。

## 利用者の追加・停止

ローカル操作を既定とする。

```sh
npm run member -- invite --email person@example.com
npm run member -- suspend --email person@example.com
npm run member -- restore --email person@example.com
```

本番は、対象ユーザーへの操作が承認された場合に限り`--remote`を付ける。招待ではメールを送信せず、許可レコードだけを作成する。再招待は既存の停止状態やGoogleの結び付きを上書きしない。所有者を停止した場合の復旧も同じ管理経路を使う。MCPのツールから利用者管理はできない。

## 公開準備

予定するWorker名は`japanese-writing-mcp`。以下のURLは公開前の候補であり、稼働確認済みURLではない。

```text
MCP:
https://japanese-writing-mcp.sado-igoneri-lp.workers.dev/mcp

Google redirect URI:
https://japanese-writing-mcp.sado-igoneri-lp.workers.dev/oauth/google/callback
```

公開には対象と操作の承認が必要。承認後、次の順で準備する。

1. 専用のOAuth KV namespaceとD1 databaseを作成し、`wrangler.jsonc`のproductionに実IDを設定する。
2. D1のmigrationをproductionへ適用する。
3. 専用Google OAuth Web clientを作成し、確定したredirect URI、同意画面、テストユーザーを設定する。将来の外部利用を見据えたaudience設定はGoogle Cloud側でも確認する。
4. `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`OWNER_EMAIL`をCloudflare Secretsで設定する。
5. `npm run check`と`npm run build`を通過した版を`npm run deploy`で公開する。プレースホルダーが残っている場合、deployスクリプトは停止する。
6. 実Googleログイン、許可外アカウントの拒否、MCPツール呼出し、token更新、対象クライアントの再接続を確認する。公開URL・deployment IDと未確認項目を記録する。

GitHub Actionsはチェックだけを実行し、自動公開しない。Workers/D1/KVの課金・上限は対象アカウントで別途確認する。公開後に利用者全員へ開放したり、Googleの同意画面を公開状態へ変更したりする操作は別途判断する。

## Grok Botなどへの利用指示

MCPを追加してGoogle認証を完了した後、BotのInstructionsに次を追加する。
GrokのCustom connectorは公開MCP URLと認証を設定する入口を提供する。実際のGrok Botへの接続・再認証は公開後に確認する。既存BotにGitHubを直接読む指示がある場合は、MCPを使う指示へ置き換える。

```text
For Japanese writing, translation, bilingual text, editing, summaries, and minutes, use the Japanese Writing MCP.
Call get_writing_guidance with the relevant purpose and operation before composing the answer. Use read_writing_reference only when another guide is needed.
Follow the returned writing rules while preserving the user's facts, conditions, responsibility, and requested format. The MCP provides guidance; you write the final text.
Use count_characters on the final draft when an exact or maximum character count is requested. Do not claim a count was verified without a successful tool result.
Ask short choices in the user's conversational language only when their intent is materially unclear. Otherwise produce the requested text directly.
If authentication or skill access fails, report that briefly. Do not claim to have loaded the protected skill or bypass it through another account.
```

## 検証

2026-09-27のローカル検証では、認証・MCPの26ケースと既存文字数CLIの8テスト、型検査、Workers dry-runが成功。`npm audit`は0件。利用者管理CLIの招待・停止・再招待時の停止維持・復旧もローカルD1で確認した。案内画面と合成データの同意画面はCodexのブラウザーで表示を確認した。実Googleログインと公開後のクライアント接続は、この検証結果に含めない。

## 設計根拠

- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- https://github.com/cloudflare/workers-oauth-provider
- https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.md
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/
- https://docs.x.ai/grok/connectors
