// Convex Auth JWT issuer config (self-hosted). Spec §4, §6.
// The backend signs session JWTs with JWT_PRIVATE_KEY and publishes JWKS; this
// declares the issuer the deployment trusts (itself).
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
