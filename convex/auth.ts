// Convex Auth wiring (self-hosted, manual setup — the CLI does not scaffold
// self-hosted). Spec §4, §6.
//
// We use the Password provider for the PASSWORD PHASE only (§6.2 step 1). The
// second-factor elevation (TOTP / email OTP / recovery codes) is OURS, layered
// on top via HTTP actions (see convex/http.ts), because Convex Auth has no
// built-in mid-flow 2FA.
//
// NOTE (hashing): the spec specifies Argon2id. Convex Auth's Password provider
// hashes inside the V8 isolate, where native modules (@node-rs/argon2) cannot
// load; the provider default is Scrypt (oslo, pure-JS). Honoring Argon2id
// requires a WASM argon2 build wired as a custom `crypto` provider — tracked as
// a Phase 1 follow-up. The elevation state machine is unaffected by this choice.
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { DataModel } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      // New accounts are provisioned by invite (§6.1); self-registration is
      // disabled. The invite-accept HTTP action calls signIn with a verified
      // email; the profile row is created/linked there.
      profile(params) {
        return {
          email: params.email as string,
          name: (params.name as string) ?? "",
        };
      },
    }),
  ],
});
