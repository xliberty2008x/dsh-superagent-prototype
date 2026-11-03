# OpenAI subscription integration: scope and pins

Upstream: https://github.com/deepseek-ai/dsh-superagent-prototype · base `6337fc823ce20251c8de8085948165c81aaa701e` (MIT). Publication branch: `codex-subscription`.

This fork includes:

- Models settings with ChatGPT status, explicit login and cancel controls.
- A Superagent task composer and Execution navigation.
- `native-openai-ui`: same-origin HTTP controls and a local-ui Source; task text is forwarded unchanged into the existing Engine. It requires nonblank input, a native OAuth grant and completed upstream setup; request bodies are limited to1MiB.
- `native-chatgpt-auth`: official OAuth login/refresh mapped to native DSH grants, including registration reuse and refresh-rotation recovery.
- `native-chatgpt-auth/integration.patch`: the complete required dependency patch for `@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.3/lib/index.js`.
- An authenticated macOS foreground launcher, repeat-open handoff, stock browser directory picker overlay, and optional migration utilities/tests.

The prototype Engine, executor, policy, prompts, skills, role presets, tool permissions and delegation are unchanged from the pinned upstream base. The native inference request/stream implementation is unchanged. No experimental budget/fetch/stop-on-error wrapper or replacement agent loop is included. Experiment data, private repositories, user profiles, credentials, sessions and logs are excluded.

## Dependencies

Runtime: `@deepseek-ai/dsh@0.2.1-rc.3`. The only native dependency code patch adapts the OpenAI catalog provider's OAuth interface, enables that login method and passes the previous native grant into explicit login. Public Responses transport retains `stream:true` and `store:false`.

Official SDK: https://github.com/openai/sign-in-with-chatgpt-devkit · pinned commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`. Its source remains unchanged. `native-chatgpt-auth/official.mjs` imports internal `oauth.js` beside `@siwc/local`'s exported entry. This is a version-coupled internal module, **not a stable public SDK export**. Review it before SDK upgrades. The SDK is fetched and built separately under its own license, not vendored here.

Expected fresh layout: `source/`, `runtime/`, `sign-in-with-chatgpt-devkit/`, `harness-home/`, `state/`. Local dependency links resolve the auth package and built SDK; the UI companion resolves the same native web-app package as the host runtime. See [installation](INSTALL.md).

## Authentication and launcher

Login is explicitly initiated by the user in Models settings. The bridge reports the official authorization URL through the native authorization interaction; it does not reuse Codex caches or credentials. Grant and bridge metadata storage is owner-only plaintext under `DSH_HOME`, not Keychain. Real account/model access depends on the user's subscription and consent.

Native web authentication remains enabled on loopback. The launcher opens the stock authenticated URL and never presents a bare root URL as a first-login link. Repeat opening signals the same process through validated owner-only PID/readiness metadata; the authenticated URL stays in process memory. There is no unauthenticated reopen endpoint or token URL file. No daemon/autostart or model/tool restrictions are added.

Workspace migration helpers are optional operator utilities. The cwd helper is a one-time plugin using the native working-directory API and is **not** loaded by the normal profile. The directory picker uses ordinary profile configuration and unmodified native browse components.

## Validation

`pnpm check` covers the source typecheck, unit suite and build. The auth and companion packages have their own offline tests. The native seam boots real native services with a synthetic grant and fixed mocked Responses stream, never real auth/inference. Launcher/handoff checks cover missing cookies, stale PID/marker, owner/mode/symlink rejection and serialized reload cleanup. See the commands in [INSTALL.md](INSTALL.md).

These checks do not guarantee a friend's account entitlement, external OAuth availability or completed repository setup. The stock prototype remains a research implementation, as described in the upstream README.
