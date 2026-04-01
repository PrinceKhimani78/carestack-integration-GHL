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

// ===============================
// 🔐 GHL CONFIG
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
    console.error(`❌ GHL Contact Error: ${err.message} - ${JSON.stringify(err.response?.data || 'No detailed error')}`);
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
  // 🐾 GLOBAL WATCHDOG: Log ALL incoming GHL hits
  console.log(`📡 GHL Webhook Hit! Body:`, JSON.stringify(body, null, 2));

  // 1. Detect the data structure
  const appointment = body.calendar;
  if (!appointment || !appointment.appointmentId) {
    console.log("⏭️  Skipping GHL event: No appointment data found");
    return;
  }

  // GHL has a typo in their webhook payload: "appoinmentStatus" (missing 't')
  const appointmentStatus = 
    appointment.appoinmentStatus ||   // GHL typo — primary field
    appointment.appointmentStatus ||  // Correct spelling (fallback)
    body.appointment_status ||        // Root-level fallback
    "";
  console.log(`📥 GHL Workflow Event | Appointment: ${appointment.appointmentId} | Status: ${appointmentStatus}`);

  const isCancelled = ["cancelled", "invalid", "no_show"].includes(appointmentStatus?.toLowerCase());


  // 2. Loop prevention — check webhook notes first
  if (appointment.notes?.includes("source:carestack")) return;

  // For cancellations: GHL sends stale webhook data (original booking state).
  // Fetch the CURRENT appointment from GHL API to get updated notes with carestack_id.
  let notes = appointment.notes || "";
  if (isCancelled) {
    try {
      console.log(`🔍 Fetching current GHL appointment ${appointment.appointmentId} to check carestack_id...`);
      const liveAppt = await getGHLAppointment(appointment.appointmentId);
      notes = liveAppt?.notes || liveAppt?.appointment?.notes || notes;
      console.log(`📋 Live GHL notes: "${notes}"`);
    } catch (err) {
      console.warn(`⚠️ Could not fetch live GHL appointment: ${err.message}. Using webhook notes.`);
    }
  }

  const carestackIdMatch = notes.match(/carestack_id:(\d+)/);
  const carestackId = carestackIdMatch ? carestackIdMatch[1] : null;

  if (carestackId) {
    if (isCancelled) {
      // ❌ CANCEL in CareStack
      console.log(`❌ GHL Cancelled — Cancelling CareStack appointment: ${carestackId}`);
      try {
        await cancelCarestackAppointment(carestackId);
        console.log(`✅ CareStack appointment ${carestackId} successfully cancelled.`);
      } catch (err) {
        console.warn(`⚠️ Could not cancel CareStack appointment: ${err.message}`);
      }
      return;
    }

    // Already linked → UPDATE in CareStack
    console.log(`🔄 Updating existing CareStack appointment: ${carestackId}`);
    await updateCarestackAppointment(carestackId, {
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      title: appointment.title
    });
  } else if (!isCancelled) {
    // New → Search for patient using root-level contact info, then Create
    console.log(`🔍 Mapping GHL contact to CareStack patient...`);
    const patientId = await getOrCreateCarestackPatient({
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email,
      phone: body.phone || body.contact_phone
    });
    
    if (!patientId) {
       console.error("❌ Could not map or create Carestack patient — skipping sync");
       return;
    }

    await createCarestackAppointment({
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      title: appointment.title || `${body.first_name} ${body.last_name}`,
      ghlAppointmentId: appointment.appointmentId,
      patientId: patientId
    }).then(async (carestackRes) => {
      // CareStack wraps response in { Content: { Id: 123, ... } }
      const csId = carestackRes?.Content?.Id || carestackRes?.id || carestackRes?.Id;
      if (csId) {
        await updateGHLAppointmentNotes(appointment.appointmentId, csId);
      } else {
        console.warn(`⚠️ Could not extract CareStack appt ID from response:`, JSON.stringify(carestackRes));
      }
    }).catch(err => {
      console.error(`❌ Failed to create CareStack appointment: ${err.message}`);
    });
  }
}
