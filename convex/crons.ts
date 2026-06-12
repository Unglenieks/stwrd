// Scheduled jobs (spec §23.2). Cadences are normative.
//
// Handlers are implemented in their domain modules across phases; this file is
// the single registration surface. Jobs reference internal mutations/actions
// once those land (claims expiry → Phase 2; outbox/IMAP/GC → Phase 3/4).
import { cronJobs } from "convex/server";

const crons = cronJobs();

// Phase 2: claim expiry sweep — every 15 min (§23.2, C-09/C-10).
// crons.interval("claim expiry sweep", { minutes: 15 }, internal.claims.sweepExpired, {});

// Phase 2/3: claim-expiring notifier — hourly (§23.2, §9.5).
// crons.interval("claim expiring notifier", { hours: 1 }, internal.claims.notifyExpiring, {});

// Phase 3: email outbox drain — every 1 min (§13, §23.2).
// crons.interval("email outbox drain", { minutes: 1 }, internal.email.drainOutbox, {});

// Phase 4: IMAP poll — every 2 min (§13, §23.2).
// crons.interval("imap poll", { minutes: 2 }, internal.email.pollInbound, {});

// Phase 5: orphaned-file GC — weekly, Sun 03:00 UTC (§18.2, §23.2).
// crons.weekly("orphaned file gc", { dayOfWeek: "sunday", hourUTC: 3, minuteUTC: 0 }, internal.storage.gcOrphans, {});

export default crons;
