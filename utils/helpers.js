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
 * Ensures a time string is formatted relative to Sydney Time (Australia/Sydney)
 * Automatically handles AEST (+10) vs AEDT (+11) DST transitions.
 */
export function formatWithTZ(timeStr) {
  if (!timeStr) return null;
  
  // Check if the string already has a timezone indicator
  const hasTZ = timeStr.endsWith("Z") || timeStr.includes("+") || (timeStr.lastIndexOf("-") > 10);
  
  if (hasTZ) {
    return new Date(timeStr).toISOString();
  }
  
  // No timezone info — interpret as Australia/Sydney local time
  // Use Intl to get the correct UTC offset for that specific date (handles AEST/AEDT automatically)
  const cleanTime = timeStr.replace(" ", "T");
  
  // Parse the naive datetime, then figure out what UTC offset Sydney has at that moment
  const naiveDate = new Date(cleanTime + "Z"); // Treat as UTC temporarily
  
  // Get Sydney's offset in minutes for the given date
  const sydneyFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    timeZoneName: "shortOffset",
  });
  const parts = sydneyFormatter.formatToParts(naiveDate);
  const tzPart = parts.find(p => p.type === "timeZoneName")?.value || "GMT+10";
  
  // Parse offset like "GMT+11" or "GMT+10"
  const offsetMatch = tzPart.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1]) : 10;
  
  // Apply the correct offset
  const offsetMs = offsetHours * 60 * 60 * 1000;
  const utcDate = new Date(new Date(cleanTime).getTime() - offsetMs);
  return utcDate.toISOString();
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
