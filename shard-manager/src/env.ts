export function getBaseUrl() {
  if (!process.env.BASE_URL) {
    throw new Error('No BASE_URL in environment')
  }
  return process.env.BASE_URL
}
