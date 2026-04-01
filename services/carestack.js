// ===============================
// 🔵 CARESTACK SERVICE
// Handles: Auth, Fetching, Updating, Webhook Processing
// Base URL: https://dentistforchickens.carestack.au
// ===============================

import axios from "axios";
import { createGHLAppointment, updateGHLAppointment } from "./ghl.js";
import { extractIdFromNotes } from "../utils/helpers.js";

const BASE_URL = process.env.CARESTACK_BASE_URL; // https://dentistforchickens.carestack.au

// ===============================
// 🔐 CARESTACK AUTH
// OAuth2 password grant flow
// Token endpoint: {BASE_URL}/connect/token
// ===============================
async function getCarestackToken() {
  const res = await axios.post(
    `${BASE_URL}/connect/token`,
    new URLSearchParams({
      grant_type: "password",
      client_id: process.env.CARESTACK_CLIENT_ID,
      client_secret: process.env.CARESTACK_CLIENT_SECRET,
      username: process.env.CARESTACK_VENDOR_KEY,
      password: process.env.CARESTACK_ACCOUNT_KEY,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  console.log("🔑 CareStack token acquired");
  return res.data.access_token;
}

// ===============================
// FETCH APPOINTMENT DETAILS
// GET {BASE_URL}/api/v1.0/appointments/{id}
// ===============================
async function getAppointmentDetails(appointmentId) {
  const token = await getCarestackToken();

  const res = await axios.get(
    `${BASE_URL}/api/v1.0/appointments/${appointmentId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
  const token = await getCarestackToken();

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
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log(`📝 Stored ghl_id:${ghlId} in CareStack appointment ${appointmentId}`);
}

// ===============================
// CREATE APPOINTMENT IN CARESTACK
// POST {BASE_URL}/api/v1.0/appointments
// Called when GHL creates a new appointment
// that needs to sync back to CareStack
// ===============================
export async function createCarestackAppointment(data) {
  const token = await getCarestackToken();

  const res = await axios.post(
    `${BASE_URL}/api/v1.0/appointments`,
    {
      startTime: data.startTime,
      endTime: data.endTime,
      patientName: data.title,
      notes: `ghl_id:${data.ghlAppointmentId} | source:ghl`,
      // 🔴 You may need additional required fields like:
      // providerId, locationId, appointmentTypeId, patientId
      // Check your CareStack API docs for required fields
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log(`✅ Created CareStack appointment: ${res.data?.appointmentId || "unknown"}`);
  return res.data;
}

// ===============================
// UPDATE APPOINTMENT IN CARESTACK
// PUT {BASE_URL}/api/v1.0/appointments/{id}
// Called when GHL updates an appointment
// ===============================
export async function updateCarestackAppointment(appointmentId, data) {
  const token = await getCarestackToken();

  await axios.put(
    `${BASE_URL}/api/v1.0/appointments/${appointmentId}`,
    {
      startTime: data.startTime,
      endTime: data.endTime,
      patientName: data.title,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log(`✅ Updated CareStack appointment: ${appointmentId}`);
}

// ===============================
// HANDLE CARESTACK WEBHOOK
// Events: Scheduled, Updated, Rescheduled
// Flow: CareStack → fetch details → create/update GHL
// ===============================
export async function handleCarestackWebhook(body, headers) {
  const event = body.event;

  // Only process appointment scheduling events
  if (!["Scheduled", "Updated", "Rescheduled"].includes(event)) {
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

  // 1. Fetch full appointment details from CareStack API
  const appointment = await getAppointmentDetails(appointmentId);

  // 2. Check if already synced (NO DB → check metadata in notes)
  //    We store "ghl_id:<id>" in CareStack appointment notes
  const ghlId = extractIdFromNotes(appointment?.notes, "ghl_id");

  // 3. Check for loop prevention — if this was created from GHL, skip
  if (appointment?.notes?.includes("source:ghl")) {
    console.log("🔁 Skipping — originated from GHL (loop prevention)");
    return;
  }

  // 4. Build the payload for GHL
  //    GHL requires: calendarId, locationId, contactId, startTime, endTime
  const payload = {
    calendarId: process.env.GHL_CALENDAR_ID,
    locationId: process.env.GHL_LOCATION_ID,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    title: appointment.patientName,
    appointmentStatus: "confirmed",
    // contactId is REQUIRED by GHL — you'll need to map/lookup the patient
    // contactId: "GHL_CONTACT_ID_FOR_THIS_PATIENT",
  };

  if (ghlId) {
    // Already synced → UPDATE existing GHL appointment
    console.log(`🔄 Updating existing GHL appointment: ${ghlId}`);
    await updateGHLAppointment(ghlId, payload);
  } else {
    // Not synced yet → CREATE new GHL appointment
    console.log(`🆕 Creating new GHL appointment`);
    const ghlRes = await createGHLAppointment(payload);

    // Store the GHL appointment ID back in CareStack notes for future linking
    if (ghlRes?.id) {
      await updateCarestackAppointmentNotes(
        appointmentId,
        ghlRes.id,
        appointment?.notes
      );
    }
  }
}
