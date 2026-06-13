"use node";
// IMAP poll (spec §13). Node-runtime action — ImapFlow needs sockets. Connects →
// fetches UNSEEN → hands each message to internal.inbound.ingestInbound → marks
// seen → disconnects. Runs on a cron (every 2 min). No-op when IMAP is
// unconfigured. Inbound mail never changes state (classification only).
import { ImapFlow } from "imapflow";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { decryptSecret } from "./lib/crypto";

interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordEnc: { ciphertext: string; iv: string; tag: string };
}

/** Best-effort plaintext body from raw RFC822 (the [LOT#id] match key is in the
 *  subject, so a rough body is fine; it's stored as the coordination record). */
function extractPlainBody(raw: string): string {
  const split = raw.indexOf("\r\n\r\n");
  let body = split >= 0 ? raw.slice(split + 4) : raw;
  // If multipart, take the first text/plain section.
  const partMatch = body.match(/Content-Type:\s*text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(\r\n--|\r\n\r\n--|$)/i);
  if (partMatch?.[1]) body = partMatch[1];
  return body.replace(/<[^>]+>/g, "").trim();
}

export const pollInbound = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const config = (await ctx.runQuery(internal.settings.imapForPoll, {})) as ImapConfig | null;
    if (!config) return; // IMAP unconfigured

    const pass = await decryptSecret(config.passwordEnc);
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids && uids.length > 0) {
        for await (const msg of client.fetch(
          uids,
          { uid: true, envelope: true, source: true },
          { uid: true },
        )) {
          const env = msg.envelope;
          const from = env?.from?.[0]?.address ?? "";
          const subject = env?.subject ?? "";
          const inReplyTo = env?.inReplyTo ?? undefined;
          const toAddress = env?.to?.[0]?.address ?? undefined;
          const bodyText = msg.source ? extractPlainBody(msg.source.toString("utf8")) : "";
          await ctx.runMutation(internal.inbound.ingestInbound, {
            imapUid: Number(msg.uid),
            from,
            subject,
            inReplyTo,
            toAddress,
            bodyText,
          });
        }
        // Mark processed so we don't re-fetch them next cycle.
        await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  },
});
