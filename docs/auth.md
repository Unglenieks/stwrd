# Auth system

Authentication, authorization, two-factor enforcement, roles, and permissions.

---

## Authentication

Stwrd uses [Convex Auth](https://labs.convex.dev/auth) with the password provider. All auth logic is in `convex/auth.ts`, `convex/auth.config.ts`, and `convex/authInternal.ts`.

### Login flow

1. Member submits email and password at `/login`.
2. Convex Auth's password provider verifies credentials against the hashed password in `authAccounts`.
3. `authInternal.ts` checks whether a second factor is required (see Two-factor section).
4. If no 2FA required: session is created immediately.
5. If 2FA required: a `mfaPending` token is issued instead. Session is created only after the second factor passes.

### Invite flow

New members join via invite only. There is no self-registration.

1. Server manager or admin creates an invite (`users.inviteUser`): creates a stub `users` row and an `invites` row with a hashed token and 72 h TTL.
2. An invite email is sent to the address.
3. Member opens the invite link (`/invite/:token`), sets a password, and activates their account.
4. Duplicate email invites throw `validation_failed`. Expired tokens throw `not_found`.

### Session management

Sessions are cookie-based (Convex Auth default). They are host-scoped — changing the site domain invalidates all existing sessions (members log in again).

---

## Two-factor authentication

**Files:** `convex/twofactor.ts`, `convex/twofactorInternal.ts`, `convex/http.ts`

### Factors supported

| Factor | Description |
|---|---|
| TOTP | Time-based one-time passwords (RFC 6238). Secret encrypted at rest with APP_SECRETS_KEY. Compatible with any authenticator app. |
| Email OTP | 6-digit code sent to the member's email address. Locks after 5 incorrect attempts; lock clears after 15 minutes. |
| Recovery codes | 8 codes generated at enrollment. Each is single-use (hashed in `twoFactor.recoveryCodeHashes`). Regenerating voids the old set. |

### Policy

Configured in `instanceSettings.twoFactorPolicy`:

- `required` — all members must enroll and use a second factor.
- `off` — 2FA is optional for members, but **full-permission accounts (server-manager, admin) are always second-factored regardless of policy**.

The full-permission-always-second-factored rule is enforced in `convex/authInternal.ts` when deciding whether to require 2FA.

### MFA pending flow

The `mfaPending` table stores short-lived (15-minute) tokens that represent "password verified, second factor not yet passed."

```typescript
// After password verification:
// 1. Insert mfaPending row with hashed token, secondFactorSatisfied: false
// 2. Return token to frontend

// After second factor verified:
// 3. Flip mfaPending.secondFactorSatisfied to true
// 4. Exchange token for a Convex session
```

---

## Roles and permissions

**Files:** `convex/roles.ts`, `packages/shared/constants.ts`, `convex/lib/permissions.ts`

### System default roles

| Role | Description |
|---|---|
| `server-manager` | Bootstrap superuser. Full permissions. Cannot be deleted or reduced below full access while they are the last holder (last-admin guard). |
| `admin` | Administrative access. Can manage members, roles, settings, and perform admin operations (force-complete, recovery). Always second-factored. |
| `member` | Standard member. Can browse, contribute, claim, and manage their own items. |

Roles are created by the setup wizard. Additional custom roles can be created by a server manager.

### Permissions

Permission strings are defined in `packages/shared/constants.ts`. Each role holds a set of permission strings. The `requirePermission` helper in `convex/lib/permissions.ts` fetches the user's roles, collects all permissions, and throws `permission_denied` if the required permission is absent.

Example permission strings:
```
items.contribute       Contribute a new item
items.edit             Edit any item's details
items.retire           Propose retirement
admin.roles            Manage roles and assignments
admin.settings         Change instance settings
admin.forceTransfer    Admin-force a custody transfer
members.invite         Send member invites
members.deactivate     Deactivate a member account
```

### Last-admin guard

`users.ts` prevents any operation that would leave zero server-manager accounts. Attempting to deactivate, demote, or remove the last server manager throws `last_admin_protected`.

### Role assignments

Many-to-many: `roleAssignments` table maps `userId` to `roleId`. A user can hold multiple roles; their effective permissions are the union of all role permission sets.

---

## Secrets encryption

**File:** `convex/lib/crypto.ts`

Sensitive values stored in the database (SMTP/IMAP passwords, TOTP secrets) are encrypted at rest using AES-256-GCM with `APP_SECRETS_KEY` (a Convex deployment env var, never a container env var).

The encrypted value is stored as `{ ciphertext, iv, tag }` (all base64 strings). The `encryptSecret` and `decryptSecret` helpers in `crypto.ts` handle serialization.

If `APP_SECRETS_KEY` is rotated, stored credentials will fail to decrypt and must be re-entered.

---

## Rate limiting

**Table:** `rateLimits`

Auth endpoints apply per-account and per-IP rate limiting. Counters use sliding windows. Keys are namespaced, e.g.:
- `"login:ip:1.2.3.4"` — login attempts from an IP
- `"otp:user:<userId>"` — email OTP attempts for a user

Rate limit state is stored in the `rateLimits` table (Convex has no shared in-memory state across function invocations, so the table is the counter store).

---

## Origin configuration and auth

**File:** `docs/domain-change.md` for the full origin runbook.

`CONVEX_SITE_ORIGIN` is the backend HTTP-actions origin where Convex Auth hosts `/.well-known/openid-configuration`, `/.well-known/jwks.json`, and all `/auth/*` endpoints. The backend resolves its own JWT issuer and JWKS URL from this value.

`CONVEX_SITE_ORIGIN` must be the origin that routes to the backend's `:3211` port. Setting it to the frontend URL will cause auth-provider discovery to fail and logins will not complete.

`SITE_URL` (Convex deployment env var) is the application URL embedded in invite and notification emails. Set to the public frontend origin.
