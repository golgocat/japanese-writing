# SAT-228: Google認証付きMCP

- ブランチ：`codex/SAT-228-google-auth-mcp`。基点はPR #2のマージコミット`dac2d759069f2f0512141fa50acf5af6161a3c45`。
- 実装：Google OIDCとMCP OAuthを分離。初回ownerは`OWNER_EMAIL`から登録し、以後はGoogle subjectに固定。招待者追加・利用停止・復旧は管理CLIから行う。
- 検証：MCP・認証26ケース、既存counter8ケース、型検査、dry-run、依存監査0件。Googleは模擬応答。案内・同意画面は合成データで目視確認。
- 公開状態：未公開。CloudflareのWorker、D1、KVは未作成。Google OAuth clientも未作成。実アカウントの資格情報は保存していない。
- 再開に必要な判断：Google Cloudの利用プロジェクト。専用プロジェクト`Japanese Writing MCP`を新規作成する案を提示済み。
- 実行前の承認対象：Cloudflareに`japanese-writing-mcp`、専用D1/KV、Google OAuth Web clientを作成・設定し、HTTPS公開と実Googleログインを検証すること。公開URL候補と具体的な手順はREADME。
- 実Googleログインでは指定されたownerアカウントを確認する。Gmail/Drive権限、外部モデル呼出し、課金機能、一般公開の利用許可は追加しない。
- Bot側ではMCP追加後にREADMEの利用指示を設定する。既存のGitHub直読指示と併用しない。Grok Botの接続成功はまだ確認していない。
