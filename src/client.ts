// @mostajs/net/client — Backwards-compatible subpath re-exporting
// the new dedicated package @mostajs/net-client-js.
//
// Avant : implémentation locale (NetClient + NetDialectProxy ~400 LOC).
// Maintenant : maintenance centralisée dans @mostajs/net-client-js (15ᵉ
// polyglotte aux côtés des 14 autres : Java, Rust, Go, Python, …).
//
// Les anciens consommateurs `import { NetClient } from '@mostajs/net/client'`
// continuent de fonctionner — c'est un alias de @mostajs/net-client-js.
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

export { NetClient, createNetDialectProxy } from '@mostajs/net-client-js'
export type {
  NetClientConfig,
  QueryOptions,
  CompareSchemaResult,
} from '@mostajs/net-client-js'
