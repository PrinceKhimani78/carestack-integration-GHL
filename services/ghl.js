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
} from "./carestack.js";

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
// CREATE APPOINTMENT IN GHL
// POST /calendars/events/appointments
// Required fields: calendarId, locationId,
//   contactId, startTime, endTime
// ===============================
export async function createGHLAppointment(data) {
  const res = await axios.post(
    `${GHL_BASE_URL}/calendars/events/appointments`,
    {
      calendarId: data.calendarId || process.env.GHL_CALENDAR_ID,
      locationId: data.locationId || process.env.GHL_LOCATION_ID,
      contactId: data.contactId, // 🔴 REQUIRED — must map CareStack patient → GHL contact
      title: data.title,
      startTime: data.startTime,
      endTime: data.endTime,
      appointmentStatus: data.appointmentStatus || "confirmed",
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
    },
    {
      headers: getGHLHeaders(),
    }
  );

  console.log(`✅ Updated GHL appointment: ${eventId}`);
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
// HANDLE GHL WEBHOOK
// Processes incoming GHL appointment events
// and syncs back to CareStack
// ===============================
export async function handleGHLWebhook(body) {
  const event = body.type;

  // Handle both create and update events
  if (!["AppointmentCreate", "AppointmentUpdate"].includes(event)) {
    console.log(`⏭️  Skipping GHL event: ${event}`);
    return;
  }

  const appointment = body.appointment || body;

  if (!appointment?.id) {
    console.warn("⚠️  No appointment data in GHL webhook payload");
    return;
  }

  console.log(`📥 GHL Event: ${event} | Appointment: ${appointment.id}`);

  // ===============================
  // 🔁 LOOP PREVENTION
  // If this appointment title/notes contain
  // "source:carestack", it was created by our sync
  // → don't sync it back
  // ===============================
  if (appointment.notes?.includes("source:carestack")) {
    console.log("🔁 Skipping — originated from CareStack (loop prevention)");
    return;
  }

  // Check if this GHL appointment is already linked to a CareStack appointment
  // We look for "carestack_id:<id>" in the appointment notes
  const carestackIdMatch = appointment.notes?.match(/carestack_id:(\w+[-\w]*)/);
  const carestackId = carestackIdMatch ? carestackIdMatch[1] : null;

  if (carestackId) {
    // Already linked → UPDATE CareStack appointment
    console.log(`🔄 Updating CareStack appointment: ${carestackId}`);
    await updateCarestackAppointment(carestackId, {
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      title: appointment.title,
    });
  } else if (event === "AppointmentCreate") {
    // New GHL appointment → CREATE in CareStack
    console.log("🆕 Creating new CareStack appointment from GHL");
    const csRes = await createCarestackAppointment({
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      title: appointment.title,
      ghlAppointmentId: appointment.id,
    });

    // If CareStack returns an ID, we should update GHL notes
    // to store the link (carestack_id:<id>)
    if (csRes?.appointmentId) {
      console.log(`📝 Link created: GHL ${appointment.id} ↔ CareStack ${csRes.appointmentId}`);
      // Optionally update GHL appointment notes via the Appointment Notes API
      // POST /calendars/events/appointments/{eventId}/notes
    }
  }
}
