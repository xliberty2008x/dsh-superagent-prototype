// Pinned official devkit; OAuth internals are intentionally version-coupled.
const sdk=await import(new URL('./oauth.js',import.meta.resolve('@siwc/local')));
export const authorize=sdk.authorize;
export const refreshConnection=sdk.refreshConnection;
