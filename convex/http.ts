// HTTP router (spec §6.2, §22.1).
//
// Convex Auth's routes are registered here. The custom second-factor elevation
// endpoints (/auth/login, /auth/mfa/send-otp, /auth/mfa/verify,
// /auth/invite/accept, /auth/logout) are layered as HTTP actions so the backend
// sees X-Forwarded-For from the proxy for per-IP rate limiting (§18.1). They are
// added in convex/authActions.ts and wired in a follow-up; the auth provider
// routes below are the foundation they build on.
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Registers Convex Auth's token/refresh endpoints on the deployment.
auth.addHttpRoutes(http);

export default http;
