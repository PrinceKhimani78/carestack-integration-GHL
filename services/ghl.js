// ===============================
// 🟢 GHL (GoHighLevel) SERVICE
// API Base: https://services.leadconnectorhq.com
// API Version: 2021-07-28
// Auth: Private Integration Token (Bearer)
// ===============================

import axios from "axios";
import {
  createCarestackAppointment,
  updateCarestackAppointment,
  cancelCarestackAppointment,
  getOrCreateCarestackPatient,
} from "./carestack.js";
import { formatWithTZ } from "../utils/helpers.js";
import { saveSyncMapping, getCarestackIdFromGhl } from "./supabase.js";

// ===============================
// 🔐 GHL CONFIG & STATE
// ===============================
const GHL_API_KEY = process.env.GHL_ACCESS_TOKEN;
const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

// Shared headers for all GHL API calls
function getGHLHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    "Content-Type": "application/json",
    Version: GHL_API_VERSION,
  };
}

// ===============================
// SEARCH OR CREATE GHL CONTACT
// Searches by email/phone or create new
// ===============================
export async function getOrCreateGHLContact(patient) {
  const headers = getGHLHeaders();
  const locationId = process.env.GHL_LOCATION_ID;
  
  try {
    // 1. Search by email first
    if (patient.email) {
      const searchRes = await axios.get(`${GHL_BASE_URL}/contacts/?locationId=${locationId}&query=${patient.email}`, { headers });
      if (searchRes.data?.contacts?.length > 0) return searchRes.data.contacts[0].id;
    }
    
    // 2. Search by phone
    if (patient.mobilePhone || patient.homePhone) {
      const phone = patient.mobilePhone || patient.homePhone;
      // encode phone just in case it has + or spaces
      const encodedPhone = encodeURIComponent(phone);
      const searchRes = await axios.get(`${GHL_BASE_URL}/contacts/?locationId=${locationId}&query=${encodedPhone}`, { headers });
      if (searchRes.data?.contacts?.length > 0) return searchRes.data.contacts[0].id;
    }

    // 3. Not found? Create NEW contact
    const safeFirstName = patient.firstName || patient.patientName || "Unknown";
    console.log(`👤 Contact not found in GHL — creating new one for ${safeFirstName}`);
    const createRes = await axios.post(`${GHL_BASE_URL}/contacts/`, {
      firstName: safeFirstName,
      lastName: patient.lastName || "",
      email: patient.email || "",
      phone: patient.mobilePhone || patient.homePhone || "",
      locationId: locationId
    }, { headers });

    return createRes.data?.contact?.id || createRes.data?.id;
  } catch (err) {
    console.error(`❌ GHL Contact Error:`, err.stack || err.message);
    if (err.response?.data) {
      console.error(`📡 GHL API Error Response:`, JSON.stringify(err.response.data));
    }
    throw err;
  }
}

// ===============================
// CREATE APPOINTMENT IN GHL
// POST /calendars/events/appointments
// ===============================
export async function createGHLAppointment(data) {
  const res = await axios.post(
    `${GHL_BASE_URL}/calendars/events/appointments`,
    {
      calendarId: data.calendarId || process.env.GHL_CALENDAR_ID,
      locationId: data.locationId || process.env.GHL_LOCATION_ID,
      contactId: data.contactId, 
      title: data.title,
      startTime: data.startTime,
      endTime: data.endTime,
      appointmentStatus: data.appointmentStatus || "confirmed",
      ignoreDateRange: true,
    },
    {
      headers: getGHLHeaders(),
    }
  );

  console.log(`✅ Created GHL appointment: ${res.data?.id || "unknown"}`);
  return res.data;
}

// ===============================
// UPDATE APPOINTMENT IN GHL
// PUT /calendars/events/appointments/:eventId
// ===============================
export async function updateGHLAppointment(eventId, data) {
  await axios.put(
    `${GHL_BASE_URL}/calendars/events/appointments/${eventId}`,
    {
      calendarId: data.calendarId || process.env.GHL_CALENDAR_ID,
      title: data.title,
      startTime: data.startTime,
      endTime: data.endTime,
      appointmentStatus: data.appointmentStatus || "confirmed",
      ignoreDateRange: true,
    },
    {
      headers: getGHLHeaders(),
    }
  );

  console.log(`✅ Updated GHL appointment: ${eventId}`);
}

// ===============================
// WRITE CARESTACK ID TO GHL APPOINTMENT NOTES
// ===============================
export async function updateGHLAppointmentNotes(ghlAppointmentId, carestackAppointmentId) {
  try {
    await axios.put(
      `${GHL_BASE_URL}/calendars/events/appointments/${ghlAppointmentId}`,
      {
        calendarId: process.env.GHL_CALENDAR_ID,
        appointmentStatus: "confirmed",
        notes: `carestack_id:${carestackAppointmentId} | source:carestack`,
        ignoreDateRange: true,
      },
      { headers: getGHLHeaders() }
    );
    console.log(`🔗 Linked CareStack ID ${carestackAppointmentId} → GHL appointment ${ghlAppointmentId}`);
  } catch (err) {
    console.warn(`⚠️ Could not write carestack_id to GHL notes: ${err.message}`);
  }
}


// ===============================
// GET APPOINTMENT FROM GHL
// GET /calendars/events/appointments/:eventId
// ===============================
export async function getGHLAppointment(eventId) {
  const res = await axios.get(
    `${GHL_BASE_URL}/calendars/events/appointments/${eventId}`,
    {
      headers: getGHLHeaders(),
    }
  );

  return res.data;
}

// ===============================
// FIND APPOINTMENT BY TIME (DEDUPLICATION)
// GET /calendars/events/appointments
// ===============================
export async function findGHLAppointmentByTime(calendarId, contactId, startTime) {
  const headers = getGHLHeaders();
  // Fetch events in a window around the start time (30 min window)
  const finalTime = formatWithTZ(startTime);
  const startObj = new Date(finalTime);
  const startDate = new Date(startObj.getTime() - 30 * 60000).toISOString();
  const endDate = new Date(startObj.getTime() + 30 * 60000).toISOString();
  const locationId = process.env.GHL_LOCATION_ID;

  const url = `${GHL_BASE_URL}/calendars/events?calendarId=${calendarId}&locationId=${locationId}&startTime=${startDate}&endTime=${endDate}`;

  try {
    const res = await axios.get(url, { headers });
    const events = res.data?.events || [];
    return events.find(e => e.contactId === contactId);
  } catch (err) {
    console.warn(`⚠️ GHL Search Failed: ${err.message} | URL: ${url} | Response: ${JSON.stringify(err.response?.data || 'None')}`);
    return null;
  }
}

// ===============================
// HANDLE GHL WEBHOOK
// Processes Workflow webhooks
// ===============================
export async function handleGHLWebhook(body) {
  try {
    console.log(`[TRACE] 1. Webhook received. Initializing handler...`);
    console.log(`[TRACE] 2. Payload size: ${JSON.stringify(body).length} bytes`);
    
    const appointment = body.calendar;
    if (!appointment || !appointment.appointmentId) {
      console.log("[TRACE] ❌ 3. ABORT: No calendar/appointmentId found in payload");
      return;
    }

    const appointmentStatus = 
      appointment.appoinmentStatus || 
      appointment.appointmentStatus || 
      body.appointment_status || 
      "";
    
    console.log(`[TRACE] 4. Appointment Status parsed: "${appointmentStatus}" | ID: ${appointment.appointmentId}`);

    const isCancelled = ["cancelled", "invalid", "no_show"].includes(appointmentStatus?.toLowerCase());
    console.log(`[TRACE] 5. Is Cancellation: ${isCancelled}`);

    if (appointment.notes?.includes("source:carestack")) {
      console.log(`[TRACE] ⏭️ 6. SKIP: Loop detected (source:carestack in notes)`);
      return;
    }

    let notes = appointment.notes || "";
    console.log(`[TRACE] 7. Current Notes: "${notes}"`);

    if (isCancelled) {
      try {
        console.log(`[TRACE] 8. Cancellation detected. Fetching LIVE GHL data for updated notes...`);
        const liveAppt = await getGHLAppointment(appointment.appointmentId);
        notes = liveAppt?.notes || liveAppt?.appointment?.notes || notes;
        console.log(`[TRACE] 9. Live Notes Result: "${notes}"`);
      } catch (err) {
        console.warn(`[TRACE] ⚠️ 8a. Live fetch failed: ${err.message}. Using webhook notes.`);
      }
    }

    const ghlIdMatch = notes.match(/ghl_id:([a-zA-Z0-9]+)/);
    const carestackIdMatch = notes.match(/carestack_id:(\d+)/);
    let carestackId = carestackIdMatch ? carestackIdMatch[1] : null;
    console.log(`[TRACE] 10. carestack_id from notes: ${carestackId || "NONE"}`);

    // Persistance Fallback 1: SUPABASE DB
    if (!carestackId) {
      console.log(`[TRACE] 11. ID not in notes. Checking Supabase DB...`);
      carestackId = await getCarestackIdFromGhl(appointment.appointmentId);
      if (carestackId) {
        console.log(`[TRACE] ✅ 12. FOUND ID in Supabase: ${carestackId}`);
      }
    }

    // Persistance Fallback 2: SEARCH CARESTACK (Last Resort)
    if (!carestackId) {
      console.log(`[TRACE] 13. ID NOT in DB. Final attempt: Searching CareStack for link...`);
      const { findCarestackAppointmentByGhlId } = await import("./carestack.js");
      carestackId = await findCarestackAppointmentByGhlId(appointment.appointmentId);
      if (carestackId) {
        console.log(`[TRACE] ✅ 14. RECOVERED ID FROM CARESTACK: ${carestackId}`);
        await saveSyncMapping(appointment.appointmentId, carestackId);
      }
    }

    if (carestackId) {
      if (isCancelled) {
        console.log(`[TRACE] 15a. ROUTE: Cancellation for CS Appt ${carestackId}`);
        await cancelCarestackAppointment(carestackId).catch(err => console.warn(`[TRACE] ❌ Cancel Fail: ${err.message}`));
      } else {
        console.log(`[TRACE] 15b. ROUTE: Update for CS Appt ${carestackId}`);
        await updateCarestackAppointment(carestackId, {
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          title: appointment.title
        }).catch(err => console.warn(`[TRACE] ❌ Update Fail: ${err.message}`));
      }
    } else if (!isCancelled) {
      console.log(`[TRACE] 15c. ROUTE: New Creation Path`);
      
      console.log(`[TRACE] 16. Resolving/Creating Patient in CareStack for ${body.email}...`);
      const patientId = await getOrCreateCarestackPatient({
        firstName: body.first_name,
        lastName: body.last_name,
        email: body.email,
        phone: body.phone || body.contact_phone
      });
      
      if (!patientId) {
        console.error("[TRACE] ❌ 17. ABORT: Could not map Carestack patient");
        return;
      }

      console.log(`[TRACE] 18. Patient Resolved: ${patientId}. Creating Appointment...`);
      await createCarestackAppointment({
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        title: appointment.title || `${body.first_name} ${body.last_name}`,
        ghlAppointmentId: appointment.appointmentId,
        patientId: patientId
      }).then(async (carestackRes) => {
        const csId = carestackRes?.Content?.Id || carestackRes?.id || carestackRes?.Id;
        console.log(`[TRACE] 19. CareStack ID returned: ${csId || "NONE"}`);
        
        if (csId) {
          console.log(`[TRACE] 20. Storing link in Supabase: ${appointment.appointmentId} → ${csId}`);
          await saveSyncMapping(appointment.appointmentId, csId);
          await updateGHLAppointmentNotes(appointment.appointmentId, csId);
        }
      }).catch(err => {
        console.error(`[TRACE] ❌ 19. createCarestackAppointment failed:`, err.response?.data || err.message);
      });
    }
  } catch (err) {
    console.error(`[TRACE] 🔴 GLOBAL ERROR in GHL Webhook:`, err.stack || err.message);
  }
}
