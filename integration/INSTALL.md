# Install the ChatGPT subscription integration on macOS

This procedure creates a **new**, isolated installation. It does not import anyone's profile, API key, Codex login, credentials, sessions or repository settings. It uses the stock DSH runtime with the small authentication patch committed in this repository. See [integration scope and pins](OPENAI-SUBSCRIPTION.md).

Prerequisites: macOS, Node.js 22.19+ or 24+, npm, pnpm11.7.0, Git, Python3 and `patch`. The full upstream Superagent workflow also needs tmux and GitHub CLI; see [upstream deployment](../docs/006-deployment.md). Install those prerequisites through your usual package manager.

## 1. Create the installation

Run in your own Terminal. Use an empty destination; these commands deliberately stop if it already exists. Do not run them over an existing installation.

```sh
set -eu
APP_ROOT="$HOME/.local/share/deepseek-superagent"
if [ -e "$APP_ROOT" ]; then
  echo 'Destination already exists; keep its data and use the upgrade notes below.' >&2
  exit 1
fi
mkdir -p "$APP_ROOT"
git clone --branch codex-subscription --single-branch \
  https://github.com/xliberty2008x/dsh-superagent-prototype.git "$APP_ROOT/source"
mkdir -p "$APP_ROOT/runtime" "$APP_ROOT/state"
cd "$APP_ROOT/runtime"
npm install --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-rc.3

git clone https://github.com/openai/sign-in-with-chatgpt-devkit.git \
  "$APP_ROOT/sign-in-with-chatgpt-devkit"
cd "$APP_ROOT/sign-in-with-chatgpt-devkit"
git checkout --detach 0a36fefeb913055c8c7a1a29b63d82b96b2e841a
npm ci --ignore-scripts
npm run build -w @siwc/local

mkdir -p "$APP_ROOT/source/native-chatgpt-auth/node_modules/@siwc" \
  "$APP_ROOT/runtime/node_modules/@local"
ln -s "$APP_ROOT/sign-in-with-chatgpt-devkit/packages/local" \
  "$APP_ROOT/source/native-chatgpt-auth/node_modules/@siwc/local"
ln -s "$APP_ROOT/source/native-chatgpt-auth" \
  "$APP_ROOT/runtime/node_modules/@local/dsh-native-chatgpt-auth"
cd "$APP_ROOT/runtime"
patch --dry-run -p1 < "$APP_ROOT/source/native-chatgpt-auth/integration.patch"
patch -p1 < "$APP_ROOT/source/native-chatgpt-auth/integration.patch"

cd "$APP_ROOT/source"
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
cd "$APP_ROOT/source/native-openai-ui"
pnpm install --frozen-lockfile --ignore-scripts
```

The relative companion dependency expects `source/` and `runtime/` to be siblings. Keep this layout. No authentication or inference is performed by these steps. The SDK is built from its pinned official source; it is not copied from the original installation.

## 2. Create a new native Web profile

Continue in the same Terminal:

```sh
export DSH_HOME="$APP_ROOT/harness-home"
DSH="$APP_ROOT/runtime/node_modules/.bin/dsh"
"$DSH" ui --from-default-profile web --dump-config > /dev/null
"$DSH" plugin --profile ui add "link:$APP_ROOT/source"
"$DSH" plugin --profile ui add "link:$APP_ROOT/source/native-openai-ui"
APP_ROOT="$APP_ROOT" node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.APP_ROOT;
const rows=[
 {id:'webserver',config:{host:'127.0.0.1',port:3088}},
 {id:'dsh-superagent',config:{stateDir:join(root,'state')}},
 {id:'llm-pi-ai',config:{providers:{openai:{}}}},
 {id:'directory-picker',disabled:true},
 {insert:[
  {id:'directory-picker-browse',name:'@deepseek-ai/dsh-host-directory-picker-browse'},
  {id:'directory-picker-browse-ui',name:'@deepseek-ai/dsh-client-ui-directory-picker-browse'}
 ]},
 {id:'native-openai-ui',config:{launcherStatePath:join(root,'ui-browser-handoff.json')}}
];
writeFileSync(join(root,'harness-home/profiles/ui/cordis.patch.yml'),JSON.stringify(rows,null,2)+'\n',{mode:0o600});
JS
mkdir -p "$HOME/Applications"
ln -s "$APP_ROOT/source/integration/macos/DeepSeek Superagent.command" \
  "$HOME/Applications/DeepSeek Superagent.command"
```

**Do not repeat `--from-default-profile` on an existing profile:** it replaces its configuration. This installer leaves all model, repository and account choices to you. It installs no service, watcher or login item. The optional upstream GitHub source remains unconfigured until you set it up.

## 3. Launch and sign in

Double-click `~/Applications/DeepSeek Superagent.command`, or run:

```sh
"$HOME/Applications/DeepSeek Superagent.command"
```

Keep the first Terminal window open; Ctrl+C stops the server. The launcher uses native authenticated browser opening. If opening manually, use the **complete `dsh web:` URL printed in that Terminal**, not the bare localhost root. Treat that process-specific URL as private. Running the same launcher while the server is active reopens it without starting another server. See [launcher troubleshooting](MACOS-LOCAL.md).

In **Settings → Models → ChatGPT subscription**, click **Continue with ChatGPT** and complete the official OpenAI sign-in/consent in your own browser. Only do this if you accept local credential storage: native DSH stores the OAuth grant in owner-only plaintext under this installation's `harness-home/`, not macOS Keychain. No API key is required; the launcher removes inherited `OPENAI_API_KEY`. Do not paste tokens into chat or copy existing Codex credential files.

After Connected appears, select an available **OpenAI** model and reasoning effort supported by your account/model. **Also set the profile default model**: in the native Plugin Manager configure `agent-default-model` with provider `openai` and the entitled model/effort you chose (or add that row to this profile's `cordis.patch.yml` while stopped). Selecting a model in one session alone does not change the profile default. A fresh stock profile defaults to DeepSeek; Superagent Eval/Execution inherit the profile default unless you explicitly set their own model overrides. Verify those settings before submitting a task. Use the normal `openai` provider, not the legacy `openai-codex` route. Entitlements and subscription limits belong to the signed-in account; an installation or successful mocked test does not guarantee a particular model is available.

A native **New session** can be used after model setup. To use **Superagent → New task**, first complete the upstream **Sources, Policy and Execution** setup with your own repository and CLI identity. The stock prototype still requires an authenticated GitHub CLI with push access to the chosen repository; local task input does not remove that requirement. Enable Local UI in Policy and allow operator identity `operator`. Review Eval's default `observe` mode before enabling execution. The task text then passes unchanged into the existing Source → Policy/Eval → Ticket → router → worker → Report path. This fork does not configure your repository, change role presets or replace that orchestration.

## Verification and development

```sh
cd "$APP_ROOT/source"
pnpm check
(cd native-chatgpt-auth && npm test)
(cd native-openai-ui && npm test)
DSH_TEST_RUNTIME="$APP_ROOT/runtime" node --test integration/macos/*.test.mjs
(cd native-chatgpt-auth && DSH_TEST_RUNTIME="$APP_ROOT/runtime" npm run test:native)
zsh -n 'integration/macos/DeepSeek Superagent.command'
```

The native-seam test uses a synthetic grant and mocked Responses stream, with no real authorization or inference. It verifies native bearer use, stream/tool projection and completion. Unit tests cover authorization rotation, sanitized errors, UI forwarding, authenticated browser handoff and workspace migration helpers.

## Upgrades and removal

Stop the server before upgrading. Keep an offline backup of your private `harness-home/` and `state/`; never commit or upload that backup. Review upstream/runtime/SDK changes and rerun tests before updating pins. A runtime reinstall replaces the patched dependency, so reapply the reviewed patch once to the exact clean version. Do not blindly apply it twice. Update the source through Git without replacing the profile or state. This fork contains no automatic updater.

To remove the application, first stop it and use the normal provider sign-out/revocation options for your own grant. Remove the launcher symlink and the installation directory when you no longer need its local data. No system daemon or global DSH installation is created by this guide.
