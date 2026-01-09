/**
 * Suparank MCP - Stats Service
 *
 * Usage statistics tracking
 */

import * as fs from 'fs'
import { getStatsFilePath, ensureSuparankDir } from '../utils/paths.js'
import { log } from '../utils/logging.js'
import { DEFAULT_STATS } from '../config.js'

/**
 * Load usage stats from file
 * @returns {object} Stats object
 */
export function loadStats() {
  try {
    const file = getStatsFilePath()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (e) {
    log(`Warning: Could not load stats: ${e.message}`)
  }
  return { ...DEFAULT_STATS }
}

/**
 * Save usage stats to file
 * @param {object} stats - Stats object to save
 */
export function saveStats(stats) {
  try {
    ensureSuparankDir()
    fs.writeFileSync(getStatsFilePath(), JSON.stringify(stats, null, 2))
  } catch (e) {
    log(`Error saving stats: ${e.message}`)
  }
}

/**
 * Increment a stat counter
 * @param {string} key - Stat key to increment
 * @param {number} amount - Amount to add (default: 1)
 */
export function incrementStat(key, amount = 1) {
  const stats = loadStats()
  stats[key] = (stats[key] || 0) + amount
  saveStats(stats)
}
