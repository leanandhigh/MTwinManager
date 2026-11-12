// Makes the signing key pair for MTwin Manager's self-updater, once.
//
//   node scripts/make-update-key.mjs
//
// Writes the private key to update-key-PRIVATE.pem (never commit or share it: whoever has it can
// make every MTwin Manager that trusts it run their installer). Put the file's whole text into the
// repository's ROALT_UPDATE_KEY secret (GitHub: Settings > Secrets and variables > Actions >
// New repository secret). The Release workflow builds MTwin Manager with the matching public half and
// signs each installer with it. Keep a copy of the .pem somewhere safe: with a new key, builds
// made with the old one won't accept updates any more.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(import.meta.dirname, "..", "update-key-PRIVATE.pem");
if (existsSync(out)) {
  console.error(`${out} already exists. Delete it first if you really want a new key.`);
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const jwk = publicKey.export({ format: "jwk" });
const hex = Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("hex");
console.log(`Private key: ${out}`);
console.log("  Copy ALL of its text into the GitHub secret ROALT_UPDATE_KEY, then keep the file somewhere safe.");
console.log(`Public key (not secret): ${hex}`);
