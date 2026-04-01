// ===============================
// 🔵 CARESTACK SERVICE
// Handles: Auth, Fetching, Updating, Webhook Processing
// Base URL: https://dentistforchickens.carestack.au
// ===============================

import axios from "axios";
import { 
  createGHLAppointment, 
  updateGHLAppointment, 
  getOrCreateGHLContact,
  findGHLAppointmentByTime 
} from "./ghl.js";
import { extractIdFromNotes, formatWithTZ } from "../utils/helpers.js";

// Helper to format phone to CareStack regex: (123) 456-7890
function formatPhone(phone) {
  if (!phone) return "";
  const cleaned = ("" + phone).replace(/\D/g, "");
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return "(" + match[1] + ") " + match[2] + "-" + match[3];
  }
  // If it's longer (e.g. +91), just try to keep it simple but it might fail
  return phone;
}

const BASE_URL = process.env.CARESTACK_BASE_URL; // https://dentistforchickens.carestack.au

// Store discovered IDs to avoid repeated API calls
let cachedLocationId = null;
let cachedOperatoryId = null;
let cachedProviderId = null;

// In-memory cache to prevent infinite retries of failed syncs
const failedAppointments = new Set();

// ===============================
// 🔐 CARESTACK AUTH HEADERS
// As per documentation, we pass 3 keys in the header
// ===============================
function getCarestackHeaders() {
  return {
    VendorKey: process.env.CARESTACK_VENDOR_KEY,
    AccountKey: process.env.CARESTACK_ACCOUNT_KEY,
    AccountId: process.env.CARESTACK_ACCOUNT_ID, // 👈 NEW: Needs to be added to .env
    "Content-Type": "application/json",
  };
}
async function getCarestackLocationId() {
  if (cachedLocationId) return cachedLocationId;
  try {
    const res = await axios.get(`${BASE_URL}/api/v1.0/locations`, { headers: getCarestackHeaders() });
    const location = res.data?.find(l => l.IsActive || l.isActive) || res.data?.[0];
    cachedLocationId = location?.Id || location?.id || 1;
    console.log(`📍 Using Location ID: ${cachedLocationId}`);
    return cachedLocationId;
  } catch (e) {
    console.log("⚠️ Location list failed — using ID 1");
    return 1;
  }
}

async function getCarestackOperatoryId() {
  if (cachedOperatoryId) return cachedOperatoryId;
  try {
    const res = await axios.get(`${BASE_URL}/api/v1.0/operatories`, { headers: getCarestackHeaders() });
    const operatory = res.data?.find(o => o.IsActive || o.isActive) || res.data?.[0];
    cachedOperatoryId = operatory?.Id || operatory?.id || 1;
    console.log(`📍 Using Operatory ID: ${cachedOperatoryId}`);
    return cachedOperatoryId;
  } catch (e) {
    console.log("⚠️ Operatory list failed — using ID 1");
    return 1;
  }
}

async function getCarestackProviderId() {
  if (cachedProviderId) return cachedProviderId;
  try {
    const res = await axios.get(`${BASE_URL}/api/v1.0/providers`, { headers: getCarestackHeaders() });
    const provider = res.data?.find(p => p.IsActive || p.isActive) || res.data?.[0];
    cachedProviderId = provider?.Id || provider?.id || 2; // Default to 2 based on previous logs
    console.log(`📍 Using Provider ID: ${cachedProviderId}`);
    return cachedProviderId;
  } catch (e) {
    console.log("⚠️ Provider list failed — using ID 2");
    return 2;
  }
}

// ===============================
// FETCH APPOINTMENT DETAILS
// GET {BASE_URL}/api/v1.0/appointments/{id}
// ===============================
async function getAppointmentDetails(appointmentId) {
  const res = await axios.get(
    `${BASE_URL}/api/v1.0/appointments/${appointmentId}`,
    {
      headers: getCarestackHeaders(),
    }
  );

  return res.data;
}

// ===============================
// UPDATE APPOINTMENT IN CARESTACK
// PUT {BASE_URL}/api/v1.0/appointments/{id}
// Used to store "ghl_id:<id>" in notes
// so we can link the two systems
// ===============================
async function updateCarestackAppointmentNotes(appointmentId, ghlId, existingNotes) {
  // Preserve existing notes — just append ghl_id
  const updatedNotes = existingNotes
    ? `${existingNotes} | ghl_id:${ghlId}`
    : `ghl_id:${ghlId}`;

  await axios.put(
    `${BASE_URL}/api/v1.0/appointments/${appointmentId}`,
    {
      notes: updatedNotes,
    },
    {
      headers: getCarestackHeaders(),
    }
  );

  console.log(`📝 Stored ghl_id:${ghlId} in CareStack appointment ${appointmentId}`);
}

// ===============================
// SEARCH OR CREATE PATIENT IN CARESTACK
// ===============================
export async function getOrCreateCarestackPatient(contact) {
  const headers = getCarestackHeaders();

  try {
    // 1. Search by email (Deep Filter) OR broad search
    const searchUrl = `${BASE_URL}/api/v1.0/patients/search`;
    console.log(`🌐 Searching CareStack for Email: ${contact.email}`);
    
    // Try BOTH specific filter and broad search term
    const searchPayload = {
      SearchTerm: contact.email,
      Limit: 5,
      IncludeInactiveRecords: true
    };

    const searchRes = await axios.post(searchUrl, searchPayload, { headers });
    console.log(`📡 CareStack Search Response:`, JSON.stringify(searchRes.data, null, 2));

    const patients = Array.isArray(searchRes.data) ? searchRes.data : 
                     (searchRes.data?.Content ? searchRes.data.Content : [searchRes.data]);

    // Careful check for existing patient
    const foundPatient = patients.find(p => 
      (p.Email?.toLowerCase() === contact.email?.toLowerCase()) || 
      (p.email?.toLowerCase() === contact.email?.toLowerCase())
    );

    if (foundPatient) {
      const pid = foundPatient.PatientId || foundPatient.patientId || foundPatient.id;
      console.log(`✅ Found existing patient: ${pid} — Updating info if changed...`);
      
      // Update Name/Phone in CareStack to match GHL latest
      try {
        const updatePayload = {
          Id: pid,
          FirstName: contact.firstName,
          LastName: contact.lastName || "Patient",
          Mobile: formatPhone(contact.phone),
          Email: contact.email,
          MaritalStatus: "Single", // 👈 REQUIRED: Fixes 500 error
          DefaultLocationId: foundPatient.defaultLocationID || foundPatient.DefaultLocationId || 1,
          DOB: foundPatient.dob ? (foundPatient.dob.includes('Z') ? foundPatient.dob : foundPatient.dob + 'Z') : "1990-01-01T00:00:00Z",
          Gender: foundPatient.gender === 0 ? "Male" : (foundPatient.gender === 1 ? "Male" : (foundPatient.gender === "Male" ? "Male" : "Female")),
          Status: "Active"
        };

        console.log(`📡 Sending Patient Update Payload:`, JSON.stringify(updatePayload, null, 2));

        const updateRes = await axios.put(`${BASE_URL}/api/v1.0/patients`, updatePayload, { headers });
        console.log(`📝 Updated profile for ${contact.firstName} (Safe ID: ${pid}) | Logic: Upsert`);
      } catch (err) {
        console.warn(`⚠️ Name Update Failed (Status: ${err.response?.status}): ${JSON.stringify(err.response?.data || err.message)}`);
      }

      return pid;
    }

    // 2. Create NEW patient if not found
    console.log(`👤 Patient not found — creating new one for ${contact.firstName} ${contact.lastName}`);
    
    // Auto-discover the main location ID for this practice
    const locationId = await getCarestackLocationId();

    const newPatientData = {
      FirstName: contact.firstName,
      LastName: contact.lastName || "Patient",
      Email: contact.email || "",
      Mobile: formatPhone(contact.phone), // 👈 FORMATTED: (123) 456-7890
      DefaultLocationId: locationId, 
      DOB: "1990-01-01T00:00:00Z", 
      Gender: "Male",              
      MaritalStatus: "Single",     
      Status: "Active"
    };

    console.log(`📡 Sending Create Patient Request:`, JSON.stringify(newPatientData, null, 2));
    
    const createRes = await axios.post(`${BASE_URL}/api/v1.0/patients`, newPatientData, { headers });

    console.log(`✅ CareStack Create Patient Response:`, JSON.stringify(createRes.data, null, 2));

    return createRes.data?.Id || createRes.data?.id || createRes.data?.patientId;
  } catch (err) {
    console.error(`❌ CareStack Patient API Error: ${err.response?.status} - ${JSON.stringify(err.response?.data || err.message)}`);
    throw err;
  }
}

// ===============================
// CREATE APPOINTMENT IN CARESTACK
// POST {BASE_URL}/api/v1.0/appointments
// ===============================
export async function createCarestackAppointment(data) {
  const locId = await getCarestackLocationId();
  const opId = await getCarestackOperatoryId();
  const provId = await getCarestackProviderId();

  // Calculate duration in minutes (default 30 if failed)
  const start = new Date(data.startTime);
  const end = new Date(data.endTime);
  const duration = Math.round((end - start) / (1000 * 60)) || 30;

  const appointmentPayload = {
    PatientId: parseInt(data.patientId),
    LocationId: locId,
    OperatoryId: opId,
    DateTime: data.startTime,
    Duration: duration,
    ProviderIds: [provId],
    BookingMode: "Online",
    Notes: `ghl_id:${data.ghlAppointmentId} | source:ghl`,
  };

  console.log(`📡 Creating CareStack Appointment:`, JSON.stringify(appointmentPayload, null, 2));

  try {
    const res = await axios.post(
      `${BASE_URL}/api/v1.0/appointments`,
      appointmentPayload,
      { headers: getCarestackHeaders() }
    );

    console.log(`✅ Created CareStack appointment! Response:`, JSON.stringify(res.data));
    return res.data;
  } catch (err) {
    console.error(`❌ CareStack Appointment Creation Failed! 
    Status: ${err.response?.status} 
    Error: ${JSON.stringify(err.response?.data || "No details")}
    Payload Sent: ${JSON.stringify(appointmentPayload)}`);
    throw err;
  }
}

// ===============================
// UPDATE APPOINTMENT IN CARESTACK
// PUT {BASE_URL}/api/v1.0/appointments/{id}
// Called when GHL updates an appointment
// ===============================
export async function updateCarestackAppointment(appointmentId, data) {
  await axios.put(
    `${BASE_URL}/api/v1.0/appointments/${appointmentId}`,
    {
      startTime: data.startTime,
      endTime: data.endTime,
      patientName: data.title,
    },
    {
      headers: getCarestackHeaders(),
    }
  );

  console.log(`✅ Updated CareStack appointment: ${appointmentId}`);
}

// ===============================
// DELETE APPOINTMENT IN CARESTACK
// DELETE {BASE_URL}/api/v1.0/appointments/{id}
// ⚠️ Using DELETE instead of /cancel because:
//   - PUT /cancel keeps the slot BLOCKED (causes booking conflicts)
//   - DELETE fully removes the appointment and FREES the slot
// ===============================
export async function cancelCarestackAppointment(appointmentId) {
  console.log(`🔄 Attempting to cancel CareStack appointment ${appointmentId}...`);
  try {
    await axios.put(
      `${BASE_URL}/api/v1.0/appointments/${appointmentId}/cancel`,
      {
        Reason: "PatientNotified",
        Notes: "Cancelled via GHL sync",
        InactivatedBy: "Practice",
        CodeRetained: false,
        ResheduleEnabled: false,
      },
      { headers: getCarestackHeaders() }
    );
    console.log(`✅ CareStack appointment ${appointmentId} CANCELLED.`);
  } catch (err) {
    console.error(`❌ Failed to cancel CareStack appointment ${appointmentId}: ${err.message}`);
    if (err.response?.data) console.error(`   Details:`, JSON.stringify(err.response.data));
    throw err;
  }
}

// ===============================
// HANDLE CARESTACK WEBHOOK
// Events: Scheduled, Updated, Rescheduled, Cancelled
// ===============================
export async function handleCarestackWebhook(body, headers) {
  const event = body.event;

  // 1. Filter for events we care about
  const handledEvents = ["Scheduled", "Updated", "Rescheduled", "Cancelled", "Deleted"];
  if (!handledEvents.includes(event)) {
    console.log(`⏭️  Skipping CareStack event: ${event}`);
    return;
  }

  const appointmentId =
    body.data?.NewAppointment?.AppointmentId ||
    body.data?.OldAppointment?.AppointmentId;

  if (!appointmentId) {
    console.warn("⚠️  No appointment ID found in CareStack webhook payload");
    return;
  }

  console.log(`📥 CareStack Event: ${event} | Appointment: ${appointmentId}`);

  // 1. Fetch full appointment details (or use old data if deleted)
  let appointment;
  try {
    appointment = await getAppointmentDetails(appointmentId);
  } catch (err) {
    if (event === "Deleted" || event === "Cancelled") {
      console.log(`ℹ️ Appointment removed from CareStack — Using archived data for cancellation.`);
      appointment = {
        notes: body.data?.OldAppointment?.Notes || body.data?.NewAppointment?.Notes,
        patientName: body.data?.OldAppointment?.PatientName || body.data?.NewAppointment?.PatientName || "Patient",
        startTime: body.data?.OldAppointment?.StartTime || body.data?.NewAppointment?.StartTime,
        endTime: body.data?.OldAppointment?.EndTime || body.data?.NewAppointment?.EndTime
      };
    } else {
      throw err;
    }
  }

  // 1.5 Fetch Full Patient Details to assure we have Name/Email for GHL Contact creation
  const patientId = 
    appointment?.PatientId || appointment?.patientId || 
    body.data?.NewAppointment?.PatientId || 
    body.data?.OldAppointment?.PatientId;

  if (patientId) {
    console.log(`👤 Fetching full details for Patient ${patientId}...`);
    try {
      const pRes = await axios.get(`${BASE_URL}/api/v1.0/patients/${patientId}`, { headers: getCarestackHeaders() });
      const fullPatient = pRes.data;
      if (fullPatient) {
        // Hydrate the appointment with full patient details
        appointment = {
          ...appointment,
          firstName: fullPatient.FirstName || fullPatient.firstName || "Patient",
          lastName: fullPatient.LastName || fullPatient.lastName || "",
          email: fullPatient.Email || fullPatient.email || "",
          mobilePhone: fullPatient.Mobile || fullPatient.mobilePhone || fullPatient.HomePhone || fullPatient.homePhone || "",
        };
        appointment.patientName = `${appointment.firstName} ${appointment.lastName}`.trim();
      }
    } catch (patErr) {
      console.warn(`⚠️ Could not fetch full profile for PatientId ${patientId}: ${patErr.message}`);
    }
  }

  // 2. Check if already synced (NO DB → check metadata in notes)
  //    We store "ghl_id:<id>" in CareStack appointment notes
  let ghlId = extractIdFromNotes(appointment?.notes || appointment?.Notes, "ghl_id");

  // 3. Check for loop prevention — if this was created from GHL, skip
  const notesString = appointment?.notes || appointment?.Notes || "";
  if (notesString.includes("source:ghl")) {
    console.log("🔁 Skipping — originated from GHL (loop prevention)");
    return;
  }

  // 4. Build the payload for GHL
  // We need a contactId before we can book an appointment
  console.log(`🔍 Mapping CareStack patient to GHL contact...`);
  const contactId = await getOrCreateGHLContact(appointment);

  if (!contactId) {
    console.warn("❌ Could not map or create GHL contact — skipping sync");
    return;
  }

  // Option 3: Double-check GHL for existing appointment if ghl_id is missing
  if (!ghlId) {
    const rawStartTime = appointment.startTime || appointment.StartTime || appointment.startDateTime || appointment.DateTime || body.data?.NewAppointment?.StartTime || body.data?.OldAppointment?.StartTime;
    if (rawStartTime) {
      console.log(`🔍 No ghl_id in notes — Searching GHL for existing appt at ${rawStartTime}...`);
      const existingAppt = await findGHLAppointmentByTime(process.env.GHL_CALENDAR_ID, contactId, rawStartTime);
      if (existingAppt?.id) {
        ghlId = existingAppt.id;
        console.log(`✅ Found orphan GHL appointment: ${ghlId}. Linking...`);
        // Silently link it back to CareStack notes for the next cycle
        await updateCarestackAppointmentNotes(appointmentId, ghlId, appointment?.notes || appointment?.Notes);
      }
    }
  }

  const rawStartTime = appointment.startTime || appointment.StartTime || appointment.startDateTime || appointment.DateTime || body.data?.NewAppointment?.StartTime || body.data?.OldAppointment?.StartTime;
  const rawEndTime = appointment.endTime || appointment.EndTime || appointment.endDateTime || body.data?.NewAppointment?.EndTime || body.data?.OldAppointment?.EndTime;

  console.log(`⏱️ RAW Time from CareStack -> Start: ${rawStartTime} | End: ${rawEndTime}`);

  if (!rawStartTime) {
    console.warn("⚠️ Cannot sync to GHL: No StartTime found in appointment data.");
    return;
  }

  const finalStartTime = formatWithTZ(rawStartTime);
  const finalEndTime = rawEndTime 
    ? formatWithTZ(rawEndTime)
    : new Date(new Date(finalStartTime).getTime() + 30 * 60000).toISOString(); // fallback 30 mins

  const payload = {
    calendarId: process.env.GHL_CALENDAR_ID,
    locationId: process.env.GHL_LOCATION_ID,
    contactId: contactId,
    startTime: finalStartTime,
    endTime: finalEndTime,
    title: appointment.patientName,
    appointmentStatus: (event === "Cancelled" || event === "Deleted") ? "cancelled" : "confirmed",
  };

  console.log("📦 GHL Payload:", JSON.stringify(payload, null, 2));

  if (!payload.startTime || !payload.endTime || !payload.contactId) {
    console.warn("⚠️ Invalid payload — skipping GHL sync", payload);
    return;
  }

  try {
    if (ghlId) {
      // Already synced → UPDATE existing GHL appointment
      console.log(`🔄 Updating existing GHL appointment: ${ghlId}`);
      await updateGHLAppointment(ghlId, payload);
    } else if (event === "Cancelled" || event === "Deleted") {
      // Cancelled but never synced to GHL → nothing to do, skip silently
      console.log(`✅ Appt ${appointmentId} was cancelled but never synced to GHL. Skipping.`);
      // Throw marker so poller caches it and stops retrying
      const skipErr = new Error("NEVER_SYNCED_CANCEL");
      skipErr.isHandled = true;
      throw skipErr;
    } else {
      // Not synced yet + active → CREATE new GHL appointment
      console.log(`🆕 Creating new GHL appointment for ${appointment.patientName}...`);
      const ghlRes = await createGHLAppointment(payload);

      // Store the GHL appointment ID back in CareStack notes for future linking
      if (ghlRes?.id) {
        await updateCarestackAppointmentNotes(
          appointmentId,
          ghlRes.id,
          appointment?.notes || appointment?.Notes
        );
      }
    }
  } catch (err) {
    const errorData = err.response?.data;
    const errorMessage = errorData?.message || "";

    if (errorMessage.includes("slot you have selected is no longer available")) {
      console.warn(`⚠️ Slot conflict in GHL — skipping sync for Appt ${appointmentId}`);
      // Throw a special marker error so the polling loop can cache this and stop retrying
      const slotErr = new Error("SLOT_CONFLICT");
      slotErr.isSlotConflict = true;
      throw slotErr;
    }

    console.error("❌ GHL ERROR FULL:", {
      status: err.response?.status,
      data: errorData,
      payload: payload
    });
    throw err;
  }
}

// ===============================
// FIND CARESTACK APPOINTMENT BY GHL ID
// ===============================
export async function findCarestackAppointmentByGhlId(ghlId) {
  console.log(`🔍 Searching CareStack for an appointment linked to GHL ID: ${ghlId}...`);
  try {
    // Search using the Sync API with a wide window (30 days)
    const modifiedSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const url = `${BASE_URL}/api/v1.0/sync/appointments?modifiedSince=${modifiedSince}`;
    const res = await axios.get(url, { headers: getCarestackHeaders() });
    
    const appointments = res.data?.Results || res.data?.Content || [];
    const match = appointments.find(a => {
      const notes = a.notes || a.Notes || "";
      return notes.includes(`ghl_id:${ghlId}`);
    });

    if (match) {
      const id = match.id || match.Id || match.AppointmentId;
      console.log(`✅ MATCH FOUND: GHL ${ghlId} → CareStack ${id}`);
      return id;
    }
    console.log(`❌ No CareStack appointment found with ghl_id:${ghlId} in the last 30 days.`);
    return null;
  } catch (err) {
    console.error(`❌ Search by GHL ID failed: ${err.message}`);
    return null;
  }
}
// Runs every 1 minute to catch non-webhook changes
// ===============================
export function startCarestackPolling(intervalMs = 60000) {
  console.log(`🚀 CareStack Auto-Scanner initialized (Interval: ${intervalMs/1000}s)`);
  
  // Wait 10 seconds for initial server boot, then scan
  setTimeout(async () => {
    try {
      await syncRecentAppointments();
    } catch (err) {
      console.error("❌ Initial scan error:", err.message);
    }
  }, 10000);

  // Then run every minute
  setInterval(async () => {
    try {
      await syncRecentAppointments();
    } catch (err) {
      console.error("❌ Scan cycle error:", err.message);
    }
  }, intervalMs);
}

async function syncRecentAppointments() {
  const headers = getCarestackHeaders();
  console.log(`🔄 Scanning CareStack for changes (Sync API)...`);

  try {
    // 1. Get a wider window (60 minutes) to ensure we never miss an update
    const scanWindowMinutes = 60;
    const modifiedSince = new Date(Date.now() - scanWindowMinutes * 60000).toISOString();

    // 2. Fetch using the official Sync API!
    const url = `${BASE_URL}/api/v1.0/sync/appointments?modifiedSince=${modifiedSince}`;
    const res = await axios.get(url, { headers });
    
    const appointments = res.data?.Results || res.data?.results || res.data?.Content || res.data?.items || [];
    
    if (appointments.length > 0) {
      console.log(`🔍 Found ${appointments.length} modification(s) in the last ${scanWindowMinutes}m. Processing...`);
      
      for (const appt of appointments) {
        // 🔍 Mapping: Handle both Case-Sensitivities (Sync API is lowercase, Webhooks are Uppercase)
        const notes = appt.notes || appt.Notes || "";
        const apptId = appt.id || appt.Id || appt.AppointmentId;

        // Skip if this appointment has failed recently to prevent infinite log loops
        if (failedAppointments.has(apptId)) continue;

        const patientId = appt.patientId || appt.PatientId;
        const status = appt.status || appt.Status || "Active";
        const startTime = appt.startDateTime || appt.StartTime || appt.DateTime;
        const endTime = appt.endDateTime || appt.EndTime;

        // 1. Loop Prevention + Synced Status Check
        if (notes.includes("source:ghl")) continue;
        
        const ghlId = extractIdFromNotes(notes, "ghl_id");

        // 🟢 PERSISTENCE: Save link to Supabase if found in CareStack
        if (ghlId && apptId) {
          saveSyncMapping(ghlId, apptId);
        }

        // 2. Skip cancelled/deleted appointments that were never synced to GHL
        //    There's nothing to cancel if it was never created in GHL
        if ((status === "Cancelled" || status === "Deleted") && !ghlId) {
          console.log(`⏭️ Appt ${apptId} is ${status} and was never in GHL. Skipping.`);
          continue; // No need to cache — just skip every time (harmless)
        }

        // 3. Reuse webhook logic (Handles both create & update/cancel)
        const mockStatus = (status === "Cancelled" || status === "Deleted") ? "Cancelled" : "Scheduled";
        
        const mockWebhookBody = {
          event: mockStatus,
          data: {
            NewAppointment: {
              AppointmentId: apptId,
              PatientId: patientId, // Crucial for looking up the patient!
              Notes: notes,
              StartTime: startTime,
              EndTime: endTime
            }
          }
        };

        try {
          await handleCarestackWebhook(mockWebhookBody, {});
        } catch (innerErr) {
          if (innerErr.isSlotConflict) {
            console.warn(`🚫 Slot conflict for Appt ${apptId} — caching for 1 hour.`);
          } else if (innerErr.isHandled) {
            console.log(`⏭️ Appt ${apptId} handled (skipped). Caching to prevent re-processing.`);
          } else {
            console.warn(`⏳ Sync failed for Appt ${apptId}: ${innerErr.message}`);
          }
          failedAppointments.add(apptId);
          setTimeout(() => failedAppointments.delete(apptId), 3600000); // Retry after 1 hour
        }
      }
    }
  } catch (err) {
    console.error("❌ Sync API Scan error:", err.message);
  }
}
