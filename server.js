// ===============================
// 🚀 MAIN SERVER ENTRY POINT
// CareStack ↔ GHL Bi-Directional Sync
// ===============================

import "dotenv/config"; // Load .env variables FIRST
import express from "express";
import bodyParser from "body-parser";

import { handleCarestackWebhook, startCarestackPolling } from "./services/carestack.js";
import { handleGHLWebhook } from "./services/ghl.js";

const app = express();
app.use(bodyParser.json());

// ===============================
// CARESTACK WEBHOOK ENDPOINT
// CareStack fires this when appointments
// are Scheduled, Updated, or Rescheduled
// ===============================
app.post("/webhook/carestack", async (req, res) => {
  // 🐾 GLOBAL WATCHDOG: Log ALL incoming CareStack hits
  console.log(`📡 CareStack Webhook Hit! Event: ${req.body?.event || "Unknown"}`);
  console.log("📦 Raw Request Body:", JSON.stringify(req.body, null, 2));

  try {
    await handleCarestackWebhook(req.body, req.headers);
    res.status(200).send("OK");
  } catch (err) {
    console.error("CareStack webhook error:", err.message || err);
    res.status(500).send("Error");
  }
});

// ===============================
// GHL WEBHOOK ENDPOINT
// GHL fires this when appointments
// are created or updated
// ===============================
app.post("/webhook/ghl", async (req, res) => {
  try {
    await handleGHLWebhook(req.body);
    res.status(200).send("OK");
  } catch (err) {
    console.error("GHL webhook error:", err.message || err);
    res.status(500).send("Error");
  }
});

// ===============================
// HEALTH CHECK
// Quick way to verify server is running
// ===============================
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sync server running on port ${PORT}`);
  
  // 🚀 Start the 1-minute Auto-Scanner loop
  startCarestackPolling(60000); 
});
