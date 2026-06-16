#!/usr/bin/env node
// Calls setup:wizard via the Convex admin HTTP API.
// All inputs come from environment variables to avoid shell quoting issues.
//
// Required env:
//   ADMIN_KEY, BACKEND_URL, SM_EMAIL, SM_PASSWORD, ORG_NAME
const { ADMIN_KEY, BACKEND_URL, SM_EMAIL, SM_PASSWORD, ORG_NAME } = process.env;

const resp = await fetch(`${BACKEND_URL}/api/function`, {
  method: "POST",
  signal: AbortSignal.timeout(30_000),
  headers: {
    "Content-Type": "application/json",
    Authorization: `Convex ${ADMIN_KEY}`,
  },
  body: JSON.stringify({
    path: "setup:wizard",
    args: {
      serverManagerName: "Server Manager",
      serverManagerEmail: SM_EMAIL,
      password: SM_PASSWORD,
      orgName: ORG_NAME,
      twoFactorPolicy: "off",
      claimExpiryHours: 72,
    },
    format: "json",
  }),
});

const raw = await resp.text();
let result;
try {
  result = JSON.parse(raw);
} catch {
  console.error("[bootstrap] Setup wizard returned non-JSON response:", raw);
  process.exit(1);
}

if (!resp.ok) {
  console.error("[bootstrap] Setup wizard HTTP error:", resp.status, JSON.stringify(result));
  process.exit(1);
}

if (result.status !== "success") {
  // "already set up" is not an error on re-runs
  if (result.errorMessage?.includes("already set up")) {
    console.log("[bootstrap] Instance already set up — skipping wizard.");
    process.exit(0);
  }
  console.error("[bootstrap] Setup wizard failed:", JSON.stringify(result));
  process.exit(1);
}
console.log("[bootstrap] Setup wizard completed.");
