/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authInternal from "../authInternal.js";
import type * as branches from "../branches.js";
import type * as categories from "../categories.js";
import type * as claims from "../claims.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as emailDrain from "../emailDrain.js";
import type * as http from "../http.js";
import type * as imapPoll from "../imapPoll.js";
import type * as inbound from "../inbound.js";
import type * as items from "../items.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_emailTemplates from "../lib/emailTemplates.js";
import type * as lib_exif from "../lib/exif.js";
import type * as lib_instance from "../lib/instance.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_passwordCrypto from "../lib/passwordCrypto.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_search from "../lib/search.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_totp from "../lib/totp.js";
import type * as me from "../me.js";
import type * as notifications from "../notifications.js";
import type * as retirements from "../retirements.js";
import type * as roles from "../roles.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as setup from "../setup.js";
import type * as storage from "../storage.js";
import type * as tags from "../tags.js";
import type * as twofactor from "../twofactor.js";
import type * as twofactorInternal from "../twofactorInternal.js";
import type * as users from "../users.js";
import type * as watches from "../watches.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  authInternal: typeof authInternal;
  branches: typeof branches;
  categories: typeof categories;
  claims: typeof claims;
  crons: typeof crons;
  email: typeof email;
  emailDrain: typeof emailDrain;
  http: typeof http;
  imapPoll: typeof imapPoll;
  inbound: typeof inbound;
  items: typeof items;
  "lib/crypto": typeof lib_crypto;
  "lib/emailTemplates": typeof lib_emailTemplates;
  "lib/exif": typeof lib_exif;
  "lib/instance": typeof lib_instance;
  "lib/ledger": typeof lib_ledger;
  "lib/notify": typeof lib_notify;
  "lib/passwordCrypto": typeof lib_passwordCrypto;
  "lib/permissions": typeof lib_permissions;
  "lib/search": typeof lib_search;
  "lib/tokens": typeof lib_tokens;
  "lib/totp": typeof lib_totp;
  me: typeof me;
  notifications: typeof notifications;
  retirements: typeof retirements;
  roles: typeof roles;
  seed: typeof seed;
  settings: typeof settings;
  setup: typeof setup;
  storage: typeof storage;
  tags: typeof tags;
  twofactor: typeof twofactor;
  twofactorInternal: typeof twofactorInternal;
  users: typeof users;
  watches: typeof watches;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
