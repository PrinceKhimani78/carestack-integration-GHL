// ===============================
// 🔵 CARESTACK SERVICE
// Handles: Auth, Fetching, Updating, Webhook Processing
// Base URL: https://dentistforchickens.carestack.au
// ===============================

import axios from "axios";
import { 
  createGHLAppointment, 
  updateGHLAppointment, 
  getOrCreateGHLContact 
} from "./ghl.js";
import { extractIdFromNotes } from "../utils/helpers.js";

const BASE_URL = process.env.CARESTACK_BASE_URL; // https://dentistforchickens.carestack.au

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
    // 1. Search by email
    if (contact.email) {
      const searchUrl = `${BASE_URL}/api/v1.0/patients?email=${encodeURIComponent(contact.email)}`;
      console.log(`🌐 Searching CareStack: ${searchUrl}`);
      const res = await axios.get(searchUrl, { headers });
      if (res.data?.length > 0) return res.data[0].patientId;
    }

    // 2. Search by phone
    const phone = contact.phone || contact.mobilePhone;
    if (phone) {
      const searchUrl = `${BASE_URL}/api/v1.0/patients?phone=${encodeURIComponent(phone)}`;
      console.log(`🌐 Searching CareStack: ${searchUrl}`);
      const res = await axios.get(searchUrl, { headers });
      if (res.data?.length > 0) return res.data[0].patientId;
    }

    // 3. Create NEW patient
    console.log(`👤 Patient not found in CareStack — creating new one for ${contact.firstName}`);
    const createRes = await axios.post(`${BASE_URL}/api/v1.0/patients`, {
      firstName: contact.firstName,
      lastName: contact.lastName || "",
      email: contact.email || "",
      mobilePhone: phone || ""
    }, { headers });

    return createRes.data?.patientId;
  } catch (err) {
    throw new Error(`CareStack Patient API Error: ${err.response?.status} - ${err.message}`);
  }
}

// ===============================
// CREATE APPOINTMENT IN CARESTACK
// POST {BASE_URL}/api/v1.0/appointments
// ===============================
export async function createCarestackAppointment(data) {
  const res = await axios.post(
    `${BASE_URL}/api/v1.0/appointments`,
    {
      startTime: data.startTime,
      endTime: data.endTime,
      patientName: data.title,
      patientId: data.patientId, // Now correctly linked
      notes: `ghl_id:${data.ghlAppointmentId} | source:ghl`,
    },
    {
      headers: getCarestackHeaders(),
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
// HANDLE CARESTACK WEBHOOK
// Events: Scheduled, Updated, Rescheduled, Cancelled
// ===============================
export async function handleCarestackWebhook(body, headers) {
  const event = body.event;

  // 1. Filter for events we care about
  const handledEvents = ["Scheduled", "Updated", "Rescheduled", "Cancelled"];
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
  // We need a contactId before we can book an appointment
  console.log(`🔍 Mapping CareStack patient to GHL contact...`);
  const contactId = await getOrCreateGHLContact(appointment);

  if (!contactId) {
    console.warn("❌ Could not map or create GHL contact — skipping sync");
    return;
  }

  const payload = {
    calendarId: process.env.GHL_CALENDAR_ID,
    locationId: process.env.GHL_LOCATION_ID,
    contactId: contactId,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    title: appointment.patientName,
    appointmentStatus: event === "Cancelled" ? "cancelled" : "confirmed",
  };

  if (ghlId) {
    // Already synced → UPDATE existing GHL appointment
    console.log(`🔄 Updating existing GHL appointment: ${ghlId}`);
    await updateGHLAppointment(ghlId, payload);
  } else if (event !== "Cancelled") {
    // Not synced yet + Not a cancellation → CREATE new GHL appointment
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
