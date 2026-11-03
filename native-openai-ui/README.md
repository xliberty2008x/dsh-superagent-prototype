This companion mounts the existing native authorization service in the stock Models footer and accepts local tasks through the prototype's documented Source interface.

It does not implement a model transport, agent loop, tool policy, budget limit or stop-on-error layer. Task text is forwarded unchanged to `SourceContext.receive`; the existing Engine, router, worker, delegation and Report flow own execution. A normal Policy entry must allow the local `operator`, as with every upstream Source.

The OpenAI connection controller exposes only authorization availability/status and the official OpenAI authorization URL. It never receives access/refresh tokens. OAuth starts only after an explicit user action. The native authorization flow writes its own credential record.

The OpenAI auth-only adapter correction and pinned official sign-in devkit are installed separately in the isolated UI runtime. The inference endpoint remains public `api.openai.com/v1/responses`. No Codex auth cache is read or copied.

Run `node --test *.test.mjs` for controller and native-browser handoff tests. They use synthetic handoff values/mocked openers and start no real authentication, inference or native task.

The optional launcherStatePath enables same-user browser reopening for the Mac launcher. It uses native connection.authenticatedUrl and the unmodified web-app opener in-process; the marker contains no authentication material. There is no new network endpoint and web authentication stays enabled. The opener export is version-coupled to dsh-web-app0.2.1-rc.3, supplied by a local runtime dependency link; review and run the handoff tests before changing that runtime version.

This integration uses the host runtime dependency link rather than installing a second Harness. Its project-local peer installation setting matches the lockfile; `pnpm install --frozen-lockfile --ignore-scripts` is the reproducible install command.
