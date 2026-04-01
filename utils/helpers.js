// ===============================
// 🧰 UTILITY HELPERS
// Shared functions used across services
// ===============================

/**
 * Extract an ID from appointment notes
 * Notes are expected to contain key:value pairs like "ghl_id:abc123"
 *
 * @param {string} notes - The notes string to search
 * @param {string} key - The key to look for (e.g. "ghl_id", "carestack_id")
 * @returns {string|null} - The extracted ID or null
 */
export function extractIdFromNotes(notes, key) {
  if (!notes) return null;

  const regex = new RegExp(`${key}:(\\w+)`);
  const match = notes.match(regex);
  return match ? match[1] : null;
}

/**
 * Simple logger with timestamp
 * @param {string} source - Service name (e.g. "CareStack", "GHL")
 * @param {string} message - Log message
 */
export function log(source, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${source}] ${message}`);
}
