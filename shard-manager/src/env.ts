export function getBaseUrl() {
  if (!process.env.APP_BASE_URL) {
    throw new Error('No APP_BASE_URL in environment')
  }
  return process.env.APP_BASE_URL
}
