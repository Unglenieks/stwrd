"use node";
// SMTP sender (spec §13). Node-runtime actions — Nodemailer needs sockets, which
// only the Node action runtime provides. Mutations enqueue into emailOutbox; this
// drains it on a cron with retry/backoff. The outbox doubles as the delivery log.
import { v } from "convex/values";
import nodemailer from "nodemailer";
import { AppError } from "@lot/shared";
import { api, internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { decryptSecret } from "./lib/crypto";
import { renderEmail } from "./lib/emailTemplates";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordEnc: { ciphertext: string; iv: string; tag: string };
  fromAddress: string;
  replyToDomain?: string;
}

async function makeTransport(smtp: SmtpConfig) {
  const pass = await decryptSecret(smtp.passwordEnc);
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.username, pass },
  });
}

/** Drain queued email (cron, every 1 min). No-op when SMTP isn't configured. */
export const drainOutbox = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const config = await ctx.runQuery(internal.settings.smtpForSend, {});
    if (!config) return; // SMTP unconfigured — leave messages queued
    const due = await ctx.runQuery(internal.email.outboxDue, { limit: 20 });
    if (due.length === 0) return;

    const transport = await makeTransport(config.smtp as SmtpConfig);
    const siteUrl = process.env.SITE_URL ?? "";
    const fromAddress = (config.smtp as SmtpConfig).fromAddress;
    const replyToDomain = (config.smtp as SmtpConfig).replyToDomain;

    for (const msg of due) {
      try {
        const { subject, text } = renderEmail(msg.template, msg.payload ?? {}, {
          orgName: config.orgName,
          siteUrl,
        });
        // Reply-to plus-address for inbound matching where supported (§13).
        const replyTo =
          msg.claimId && replyToDomain ? `library+claim-${msg.claimId}@${replyToDomain}` : undefined;
        const info = await transport.sendMail({
          from: fromAddress,
          to: msg.to,
          subject,
          text,
          replyTo,
        });
        await ctx.runMutation(internal.email.markSent, { id: msg._id, messageId: info.messageId });
      } catch (err) {
        await ctx.runMutation(internal.email.recordFailure, {
          id: msg._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
});

/** Send a test email to verify the SMTP config (§13, §22.2 settings.testSmtp). */
export const testSmtp = action({
  args: { to: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    // Permission is enforced via a lightweight query into requirePermission.
    await ctx.runQuery(api.settings.requireSettingsAccess, {});
    const config = await ctx.runQuery(internal.settings.smtpForSend, {});
    if (!config) throw new AppError("smtp_unconfigured");
    const smtp = config.smtp as SmtpConfig;
    const transport = await makeTransport(smtp);
    await transport.sendMail({
      from: smtp.fromAddress,
      to: args.to ?? smtp.fromAddress,
      subject: `${config.orgName} SMTP test`,
      text: `This is a test email from ${config.orgName}. SMTP is working.`,
    });
    return { ok: true };
  },
});
