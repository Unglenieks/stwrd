# First-run checklist

After the bootstrap container finishes, Stwrd is running but minimally configured.
This page walks through the steps every server manager should take before inviting members.

---

## 1. Reset your password

If the bootstrap generated a random password for you (the default in production), reset it
immediately before doing anything else.

1. Log in at your instance URL with the credentials from `deploy/secrets/server-manager-credentials.txt`.
2. Click your avatar → **Account settings**.
3. Under **Password**, enter the current (generated) password and choose a new one.
4. Save. The old password stops working immediately.

Store the new password in your password manager.

---

## 2. Set your organisation name and claim window

Go to **Admin → Settings → Organisation**.

- **Organisation name** — shown in the app header and email subjects. Change it from the
  default (`My Library`) to your group's real name.
- **Claim expiry** — how long a pending claim is held open before it expires automatically.
  72 hours is a reasonable default; adjust to match how your group operates.

---

## 3. Configure email (recommended)

Without email, Stwrd works fine — notifications are in-app only and members log in with
password + (optionally) TOTP. Email unlocks:

- Email OTP as a second factor
- Handoff notifications to members who prefer email
- Invite-by-email links for new members

Go to **Admin → Settings → Email (SMTP)**. You will need:

| Setting | Example |
|---|---|
| Host | `smtp.fastmail.com` |
| Port | `465` (SSL) or `587` (STARTTLS) |
| Username | `library@example.org` |
| Password | app password from your mail provider |
| From address | `Library Stwrd <library@example.org>` |

After saving, use the **Send test email** button to confirm delivery.

---

## 4. Enable two-factor authentication (optional but recommended)

Two-factor authentication is **off** by default so you can log in and configure the instance
before locking it down. Once you have email or TOTP working, turn it on.

Go to **Admin → Settings → Security**.

- **Policy: off** — members choose whether to enable 2FA on their own account.
- **Policy: required** — every member must enrol a second factor before they can use the app.

For most organisations, **required** is the right choice once email is configured.

> If you set policy to **required** before configuring email, members who do not have a TOTP
> app enrolled will be locked out. Configure SMTP first, then flip the policy.

---

## 5. Enrol your own second factor

Once 2FA is enabled at the policy level, complete your own enrolment:

1. Click your avatar → **Account settings → Two-factor authentication**.
2. Choose TOTP (authenticator app) or email OTP.
3. Follow the enrolment flow and save the recovery codes somewhere safe.

---

## 6. Invite your first members

Go to **Admin → Members → Invite**. Stwrd sends each invitee a one-time invite link.
They set their own password when accepting.

Members who join via invite do not need a server-manager password.

---

## 7. Keep the admin key safe

The admin key printed in `deploy/secrets/server-manager-credentials.txt` is required for:

- Automated backups (`make backup`)
- Restore operations (`make restore`)
- Upgrading the backend (`make up` after bumping the image digest)
- Emergency account recovery

Store it in your password manager or a secrets vault. It does **not** expire.

---

## 8. Set up nightly backups

Add this to the host's crontab (`crontab -e`):

```cron
0 2 * * * cd /path/to/stwrd/deploy && make backup
```

Stwrd exports a self-contained `.zip` snapshot of all tables and file storage.
Keep 14 daily and at least 4 weekly copies. Test the restore path at least once with:

```bash
make restore SNAPSHOT=backups/snapshot-<date>.zip
```

---

## Domain change

If you ever move Stwrd to a new domain, see [`docs/domain-change.md`](./domain-change.md).
The short version: update `SITE_ORIGIN` and `CONVEX_CLOUD_ORIGIN` in `.env`, then restart.
No image rebuild or redeployment is needed.
