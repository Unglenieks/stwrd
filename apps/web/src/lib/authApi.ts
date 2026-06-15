// Client for the custom /auth/* HTTP actions (spec §22.1). These are separate
// from Convex Auth's own action surface: they implement password + second-factor
// elevation and return a completion token, which the caller then exchanges for a
// session via Convex Auth's signIn("credentials", { completionToken }).
import { ERROR_MESSAGES, isErrorCode, type ErrorCode } from "@stwrd/shared";

export class AuthError extends Error {
  readonly code: ErrorCode | "unknown";
  constructor(code: string, message?: string) {
    const known = isErrorCode(code) ? code : "unknown";
    super(message ?? (known !== "unknown" ? ERROR_MESSAGES[known] : "Something went wrong."));
    this.name = "AuthError";
    this.code = known;
  }
}

async function postAuth<T>(siteUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new AuthError(String(data.error ?? "unknown"), data.message as string | undefined);
  }
  return data as T;
}

export interface LoginResult {
  status: "complete" | "mfa_required";
  completionToken?: string;
  pendingToken?: string;
  methods?: string[];
}

export const authApi = {
  login: (siteUrl: string, email: string, password: string) =>
    postAuth<LoginResult>(siteUrl, "/auth/login", { email, password }),

  sendOtp: (siteUrl: string, pendingToken: string) =>
    postAuth<{ status: string }>(siteUrl, "/auth/mfa/send-otp", { pendingToken }),

  verifyMfa: (
    siteUrl: string,
    pendingToken: string,
    factor: { otp?: string; totp?: string; recoveryCode?: string },
  ) =>
    postAuth<{ status: "complete"; completionToken: string }>(siteUrl, "/auth/mfa/verify", {
      pendingToken,
      ...factor,
    }),

  acceptInvite: (siteUrl: string, token: string, password: string) =>
    postAuth<{ status: "complete"; completionToken: string; enroll2fa: boolean }>(
      siteUrl,
      "/auth/invite/accept",
      { token, password },
    ),
};
