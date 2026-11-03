# Native DSH ChatGPT authentication adaptation

This package implements pi-ai's existing `OAuthAuth` interface: `login(interaction, options)`, `refresh(credential, signal)`, and `toAuth(credential)`. It contains no model transport, fetch interception, agent loop, task processing or budget wrapper.

The caller injects the official `authorize()` and `refreshConnection()` functions from OpenAI's sign-in devkit, pinned at `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`. The module is built at `<app-root>/sign-in-with-chatgpt-devkit/packages/local/dist/oauth.js`; see [fresh installation](../integration/INSTALL.md).

These are internal source exports, so the integration is pinned rather than represented as a public SDK configuration switch. The native pi-ai OpenAI Responses implementation remains responsible for model requests and tools.

## Integration

Add this repository as the runtime's local file dependency `@local/dsh-native-chatgpt-auth`. `integration.patch` is a unified adapter patch generated against the installed `dsh-llm-pi-ai` rc.3; rc.5 has the same relevant source. Review and dry-check it against the selected runtime before applying.

1. Adapt the cached `openai` catalog provider's OAuth implementation, covering both login and later native refresh.
2. Offer OpenAI OAuth instead of suppressing it in `UNSERVED_OAUTH`.
3. Pass the currently stored native grant into the login options for validated registration/account reuse. Alternatively supply `readCurrentCredential` to the factory; it is invoked only during an explicit login.
4. Keep `apiKeyEnv` unset for this route and launch without a paid OpenAI key. Use the normal native provider/model selectors. Do not select legacy `openai-codex` or its backend-api transport.

Constructing the factory and mounting the provider perform no filesystem or network operations. Real sign-in begins only when the user starts the native OAuth flow after approving its permissions and storage. The bridge reports the official authorization URL through the existing pi-ai interaction surface. It never receives a copied Codex session or credential.

## Owned metadata and native grant

On actual login/refresh only, the bridge creates a `0700` namespace directory and atomic, fsynced `0600` JSON files:

- `host.json`: stable installation UUID, sent as `urn:uuid:…`.
- `registration.json`: issued client ID retained even when code exchange fails.
- `refresh-<checkpoint UUID>.json`: received rotation or verified successor pending native credential commitment.

The native OAuth grant preserves the full validated `StoredConnection` under `nativeChatGPT.connection`; native `access`, `refresh`, `expires`, `clientId` and `scopes` fields remain available to pi-ai. `toAuth()` is still bearer derivation only.

Metadata and native grants contain secrets. These files are owner-only plaintext, not encrypted/keychain storage; the user must approve this storage before a real grant. Neither files nor token values should enter browser state, logs or agent tool environments. The integration should include this namespace in its native logout cleanup; it must not remove a pending checkpoint merely because an uncommitted refresh returned.

Refresh already runs under DSH's credential-record lock. The bridge therefore writes its own atomic checkpoint rather than recursively acquiring that lock. It keeps a verified successor until a subsequent refresh receives that same successor from the native stored credential. If native commitment failed, an old native credential recovers the retained successor without rotating again. After the stored successor proves commitment, a later refresh may retire its predecessor checkpoint.

Provider exceptions become fixed, sanitized messages; raw provider bodies and error causes are not propagated. This protects the bridge boundary, not arbitrary logging elsewhere in the host.

## Offline verification

```sh
node --test test/*.test.mjs
```

All five tests use injected synthetic OAuth functions and temporary directories. They cover lazy initialization, registration reuse after exchange failure, full grant mapping, rotation checkpoint/restart recovery, failed native commitment, commitment-proven cleanup, file permissions, scope rejection and error sanitation. No real login, OAuth grant, inference request or network transport runs in these tests.

After applying the adapter patch, set `DSH_TEST_RUNTIME` to the absolute isolated `runtime/` directory and run `npm run test:native` for the standalone native-seam check. It boots only the real DSH LLM, credential and authorization services in a fresh temporary `DSH_HOME`, stores a synthetic grant there, and calls `llm.stream()` with text and a function schema. A fetch mock is installed before native imports and never calls an original transport. The test checks public Responses routing, bearer selection, `store:false`, `stream:true`, native tool projection (including `additional_tools`), completed native finish and usage. It starts neither authorization nor agent loops and does not exercise image attachments or real account entitlements.
