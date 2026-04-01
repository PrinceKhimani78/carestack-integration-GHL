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
  
  // 1. Search by email first
  if (patient.email) {
    const searchRes = await axios.get(`${GHL_BASE_URL}/contacts/search?query=${patient.email}`, { headers });
    if (searchRes.data?.contacts?.length > 0) return searchRes.data.contacts[0].id;
  }
  
  // 2. Search by phone
  if (patient.mobilePhone || patient.homePhone) {
    const phone = patient.mobilePhone || patient.homePhone;
    const searchRes = await axios.get(`${GHL_BASE_URL}/contacts/search?query=${phone}`, { headers });
    if (searchRes.data?.contacts?.length > 0) return searchRes.data.contacts[0].id;
  }

  // 3. Not found? Create NEW contact
  console.log(`👤 Contact not found in GHL — creating new one for ${patient.firstName || patient.patientName}`);
  const createRes = await axios.post(`${GHL_BASE_URL}/contacts/`, {
    firstName: patient.firstName || patient.patientName,
    lastName: patient.lastName || "",
    email: patient.email || "",
    phone: patient.mobilePhone || patient.homePhone || "",
    locationId: process.env.GHL_LOCATION_ID
  }, { headers });

  return createRes.data?.contact?.id;
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
// Processes Workflow webhooks
// ===============================
export async function handleGHLWebhook(body) {
  // 1. Detect the data structure
  const appointment = body.calendar;
  if (!appointment || !appointment.appointmentId) {
    console.log("⏭️  Skipping GHL event: No appointment data found");
    return;
  }

  console.log(`📥 GHL Workflow Event | Appointment: ${appointment.appointmentId} | Status: ${body.appointment_status}`);

  // 2. Loop prevention
  if (appointment.notes?.includes("source:carestack")) return;

  const notes = appointment.notes || "";
  const carestackIdMatch = notes.match(/carestack_id:(\d+)/);
  const carestackId = carestackIdMatch ? carestackIdMatch[1] : null;

  if (carestackId) {
    if (body.appointment_status === "cancelled" || body.appointment_status === "invalid") {
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
  } else if (body.appointment_status !== "cancelled" && body.appointment_status !== "invalid") {
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
    });
  }
}
