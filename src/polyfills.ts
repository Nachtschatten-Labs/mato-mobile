// Browsers provide Web Crypto and TextEncoder. Keep the web entrypoint free of
// native dependencies; Metro chooses polyfills.native.ts for native builds.
export {}
