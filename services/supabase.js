import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kvwvhytbatyfkcppwace.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Maps a GHL ID to a CareStack ID in Supabase
 */
export async function saveSyncMapping(ghlId, carestackId) {
  console.log(`💾 DB: Mapping GHL ${ghlId} → CS ${carestackId}`);
  const { error } = await supabase
    .from("appointment_sync")
    .upsert({ 
      ghl_id: String(ghlId), 
      carestack_id: String(carestackId),
      updated_at: new Date().toISOString()
    }, { onConflict: "ghl_id" });

  if (error) console.error(`❌ DB Save Error: ${error.message}`);
}

/**
 * Finds a CareStack ID given a GHL ID
 */
export async function getCarestackIdFromGhl(ghlId) {
  console.log(`🔍 DB: Looking up CareStack ID for GHL ${ghlId}...`);
  const { data, error } = await supabase
    .from("appointment_sync")
    .select("carestack_id")
    .eq("ghl_id", String(ghlId))
    .single();

  if (error && error.code !== "PGRST116") { // Skip "not found" error logs
    console.error(`❌ DB Lookup Error: ${error.message}`);
  }
  
  return data?.carestack_id || null;
}

/**
 * Finds a GHL ID given a CareStack ID (Reverse lookup)
 */
export async function getGhlIdFromCarestack(carestackId) {
  const { data, error } = await supabase
    .from("appointment_sync")
    .select("ghl_id")
    .eq("carestack_id", String(carestackId))
    .single();

  if (error && error.code !== "PGRST116") {
    console.error(`❌ DB Reverse Lookup Error: ${error.message}`);
  }
  
  return data?.ghl_id || null;
}
