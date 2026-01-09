/**
 * Suparank MCP - Logging Utilities
 *
 * Standardized logging to stderr (stdout is for MCP protocol)
 */

/**
 * Log message to stderr with [suparank] prefix
 * @param {...any} args - Arguments to log
 */
export function log(...args) {
  console.error('[suparank]', ...args)
}

/**
 * Structured progress logging for user visibility
 * @param {string} step - Current step name
 * @param {string} message - Progress message
 */
export function progress(step, message) {
  console.error(`[suparank] ${step}: ${message}`)
}

/**
 * Log warning message
 * @param {...any} args - Arguments to log
 */
export function warn(...args) {
  console.error('[suparank] WARNING:', ...args)
}

/**
 * Log error message
 * @param {...any} args - Arguments to log
 */
export function error(...args) {
  console.error('[suparank] ERROR:', ...args)
}
