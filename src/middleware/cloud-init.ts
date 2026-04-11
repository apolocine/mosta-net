// @mostajs/net — Cloud Middleware init (delegates to @mostajs/cloud-middleware)
// Author: Dr Hamid MADANI drmdh@msn.com

export async function initCloudMiddleware(pm: any) {
  try {
    const { initCloudFromEnv } = await import('@mostajs/cloud-middleware/server')
    return initCloudFromEnv(pm)
  } catch (e: any) {
    console.log(`  Cloud middleware: not available — ${e.message}`)
    return null
  }
}
