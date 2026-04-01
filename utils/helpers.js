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
 * Ensures a time string is formatted relative to Sydney Time (+11:00)
 * if no timezone is already present.
 */
export function formatWithTZ(timeStr) {
  if (!timeStr) return null;
  
  // Check if the string already has a timezone indicator:
  // 1. Ends with 'Z'
  // 2. Contains '+'
  // 3. Contains a '-' AFTER the date part (e.g. 2026-05-04T10:00:00-05:00)
  const hasTZ = timeStr.endsWith("Z") || timeStr.includes("+") || (timeStr.lastIndexOf("-") > 10);
  
  if (hasTZ) {
    return new Date(timeStr).toISOString();
  }
  
  // Default to Sydney (+11:00) for clean strings like '2026-05-04T10:45:00'
  const cleanTime = timeStr.replace(" ", "T"); // Ensure ISO format
  return new Date(`${cleanTime}+11:00`).toISOString();
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
