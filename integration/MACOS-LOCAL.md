# macOS launcher and local operation

For a fresh installation follow [INSTALL.md](INSTALL.md). The layout is `~/.local/share/deepseek-superagent/{source,runtime,harness-home,state,sign-in-with-chatgpt-devkit}` by default, outside temporary folders. Keep credentials and state outside the source checkout.

Launch by double-clicking `~/Applications/DeepSeek Superagent.command`, or run:

```sh
"$HOME/Applications/DeepSeek Superagent.command"
```

The Applications entry must be a symlink to `source/integration/macos/DeepSeek Superagent.command`; do not copy the script elsewhere. It derives the app root from that canonical location, adds the usual Homebrew executable directories to its own PATH, removes inherited `OPENAI_API_KEY`, sets the isolated `DSH_HOME` and executes stock `dsh ui`.

The first Terminal stays open while the server runs. Ctrl+C stops it; after reboot use the same launcher. Running it again while the server is active reopens the browser without a duplicate server. No privileged service, daemon or login item is installed.

## Browser authentication

Use the browser opened by native DSH. For manual first entry use the **complete `dsh web:` URL printed by DSH in the running Terminal**. That URL belongs to the running process and should be kept private. `http://127.0.0.1:3088/` without an existing browser cookie correctly returns `dsh web authentication required; reopen the URL printed by dsh web.` The clean root is not a login link.

The optional `native-openai-ui.launcherStatePath` enables repeat opening. Its marker contains only PID, generation, sequence and readiness/status; no URL, cookie, signing secret or OAuth token. The launcher validates the marker's owner,0600 mode, regular-file status, listener PID and readiness before sending same-user SIGUSR2. The app invokes native `connection.authenticatedUrl(webApp.getAdvertisedUrl())` and the unmodified native web-app opener in process. A process-lifetime no-op dispatcher and generation-aware serialized writes cover late signals and reload cleanup.

An unknown/older listener without the hook fails closed. Stop that known installation in its original Terminal and start the updated launcher; do not disable web authentication or widen the network binding. A port occupied by another application is not killed automatically.

Subscription authorization is separate: **Settings → Models → ChatGPT subscription**. A successful web handoff does not imply ChatGPT Connected or repository setup completion.

## Directory picker and optional migration

`browser-picker.cordis.patch.yml` disables the native auto picker and inserts the stock browse backend/client pair once. A Cordis patch's `name` field is an assertion, not a rename. No native dependency code is changed for this picker.

For an existing installation being relocated, `workspace-paths.mjs` rebases only matching workspace-v2 paths while retaining IDs and session membership. Work offline with a backup; unsupported versions and missing targets fail before a write. Session headers are immutable: `session-cwd-migration.mjs` is a separate one-time operator plugin that uses native `workingDirectory.set`, preserves later user-selected cwd and appends a normal change event. Do not load it in the normal profile or rewrite compressed history. Fresh installs need neither migration utility.

Focused tests:

```sh
DSH_TEST_RUNTIME=<absolute-runtime-directory> node --test integration/macos/*.test.mjs
(cd native-openai-ui && npm test)
zsh -n 'integration/macos/DeepSeek Superagent.command'
```
