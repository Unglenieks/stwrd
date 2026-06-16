// Generate an RS256 key pair using Node.js built-in crypto (no external deps).
// Outputs JSON: { JWT_PRIVATE_KEY, JWKS } in the format @convex-dev/auth expects.
import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";

const genKeyPair = promisify(generateKeyPair);

const { privateKey, publicKey } = await genKeyPair("rsa", { modulusLength: 2048 });

const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" });
const jwk = publicKey.export({ format: "jwk" });

console.log(
  JSON.stringify({
    JWT_PRIVATE_KEY: pkcs8.trimEnd().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...jwk }] }),
  }),
);
