// Internal reads supporting twofactor.ts enrollment actions (spec §6.2).
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** Org name + the user's email, for building the otpauth enrollment URI. */
export const orgAndEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const settings = await ctx.db.query("instanceSettings").first();
    const user = await ctx.db.get(userId);
    return {
      orgName: settings?.orgName ?? "Library of Things",
      email: user?.email ?? "member",
    };
  },
});

export const twoFactorRow = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!tf) return null;
    return { totpEnrolled: Boolean(tf.totpEnabledAt) };
  },
});
