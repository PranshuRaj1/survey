declare module '*.sql?raw' {
  const content: string
  export default content
}

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database
    KV: KVNamespace
  }
}
