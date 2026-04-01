import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.CARESTACK_BASE_URL;

function getCarestackHeaders() {
  return {
    VendorKey: process.env.CARESTACK_VENDOR_KEY,
    AccountKey: process.env.CARESTACK_ACCOUNT_KEY,
    "X-Account-Id": process.env.CARESTACK_ACCOUNT_ID, // Use X-Account-Id or AccountId depending on endpoint
    "AccountId": process.env.CARESTACK_ACCOUNT_ID,
    "Content-Type": "application/json",
  };
}

async function getStatuses() {
  try {
    const res = await axios.get(`${BASE_URL}/api/v1.0/appointment-status`, {
      headers: getCarestackHeaders()
    });
    console.log("\n--- CARESTACK APPOINTMENT STATUSES ---");
    res.data.forEach(s => console.log(`ID: ${s.Id || s.id}, Name: ${s.Name || s.name}, Label: ${s.Label || s.label}`));
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}
getStatuses();
