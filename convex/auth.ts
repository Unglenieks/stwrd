// Convex Auth wiring (self-hosted, manual setup — the CLI does not scaffold
// self-hosted). Spec §4, §6.
//
// Design: a single ConvexCredentials provider whose `authorize` only ever
// consumes a VERIFIED single-use completion token (our `mfaPending` row, marked
// ready once every required factor has passed) and returns the userId — Convex
// Auth then mints the session. Password verification and the second-factor
// elevation state machine (§6.2) live in the /auth/* HTTP actions
// (convex/http.ts), which is also where per-IP rate limiting sees
// X-Forwarded-For (§18.1). Account secrets are hashed with our isolate-safe
// PBKDF2 (see lib/passwordCrypto.ts — DEVIATION from Argon2id, documented there).
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth } from "@convex-dev/auth/server";
import { AppError } from "@stwrd/shared";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { hashSecret, verifySecret } from "./lib/passwordCrypto";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials<DataModel>({
      id: "credentials",
      // Hashing for createAccount/retrieveAccount secret storage (§6.2).
      crypto: { hashSecret, verifySecret },
      // Mints a session only when handed a completion token our elevation flow
      // has already marked verified (password + any required second factor).
      authorize: async (credentials, ctx) => {
        const completionToken = credentials.completionToken;
        if (typeof completionToken !== "string" || completionToken.length === 0) {
          throw new AppError("unauthenticated");
        }
        const userId: Id<"users"> | null = await ctx.runMutation(
          internal.authInternal.consumeCompletionToken,
          { rawToken: completionToken },
        );
        if (!userId) throw new AppError("unauthenticated");
        return { userId };
      },
    }),
  ],
});
