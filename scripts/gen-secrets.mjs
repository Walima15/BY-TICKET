#!/usr/bin/env node
/**
 * Creates `apps/web/.env.local` from `apps/web/.env.example` (if missing) and fills EMPTY secret
 * values with freshly generated ones. Existing values are never overwritten
 * unless `--force` is passed.
 *
 *   npm run secrets              # generate missing secrets
 *   npm run secrets -- --fund    # also fund the platform account on testnet (Friendbot)
 *   npm run secrets -- --force   # regenerate everything (invalidates existing custodial data!)
 *
 * Uses only Node's built-in crypto. Nothing is sent over the network except the
 * optional Friendbot request, which only contains the PUBLIC key.
 */
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");
const examplePath = resolve(appDir, ".env.example");
const envPath = resolve(appDir, ".env.local");
const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const fund = args.has("--fund");

// ---- Stellar StrKey (ed25519) encoding, per SEP-23 ----------------------------
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const VERSION_PUBLIC = 6 << 3; // 'G'
const VERSION_SEED = 18 << 3; // 'S'

function crc16xmodem(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function strkey(version, raw32) {
  const payload = Buffer.concat([Buffer.from([version]), raw32]);
  const crc = crc16xmodem(payload);
  return base32(Buffer.concat([payload, Buffer.from([crc & 0xff, crc >> 8])]));
}

function ed25519Raw() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");
  return { pub, seed };
}

// ---- Generators ----------------------------------------------------------------
const qr = ed25519Raw();
const platform = ed25519Raw();
const generated = {
  CUSTODIAL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  QR_CREDENTIAL_SIGNING_KEY: qr.seed.toString("base64url"),
  NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY: qr.pub.toString("base64url"),
  STELLAR_PLATFORM_SECRET: strkey(VERSION_SEED, platform.seed),
  NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY: strkey(VERSION_PUBLIC, platform.pub),
};
// Key pairs must be written together or not at all.
const pairs = [
  ["QR_CREDENTIAL_SIGNING_KEY", "NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY"],
  ["STELLAR_PLATFORM_SECRET", "NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY"],
];

// ---- Write .env.local --------------------------------------------------------------
if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log("Created apps/web/.env.local from apps/web/.env.example");
}

const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
const current = Object.fromEntries(
  lines
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

const toWrite = new Set();
for (const key of Object.keys(generated)) {
  if (force || !current[key]) toWrite.add(key);
}
for (const [a, b] of pairs) {
  if (toWrite.has(a) || toWrite.has(b)) {
    if (current[a] && current[b] && !force) {
      toWrite.delete(a);
      toWrite.delete(b);
    } else {
      toWrite.add(a);
      toWrite.add(b);
    }
  }
}

const seen = new Set();
const out = lines.map((line) => {
  const m = line.match(/^([A-Z0-9_]+)=/);
  if (m && toWrite.has(m[1])) {
    seen.add(m[1]);
    return `${m[1]}=${generated[m[1]]}`;
  }
  return line;
});
for (const key of toWrite) {
  if (!seen.has(key)) out.push(`${key}=${generated[key]}`);
}
writeFileSync(envPath, out.join("\n"));

if (toWrite.size === 0) {
  console.log("All secrets already set. Use --force to regenerate.");
} else {
  for (const key of toWrite) {
    const shown = key.startsWith("NEXT_PUBLIC_") ? generated[key] : "(hidden)";
    console.log(`  set ${key} ${shown}`);
  }
}

// ---- Optional: fund platform account on testnet ------------------------------------
if (fund) {
  const finalEnv = readFileSync(envPath, "utf8");
  const network = finalEnv.match(/^NEXT_PUBLIC_STELLAR_NETWORK=(.*)$/m)?.[1]?.trim();
  const pub = finalEnv.match(/^NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY=(.*)$/m)?.[1]?.trim();
  if (network !== "testnet") {
    console.error("--fund only works on testnet (NEXT_PUBLIC_STELLAR_NETWORK=testnet).");
    process.exit(1);
  }
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(pub)}`);
  if (res.ok) console.log(`Funded platform account ${pub} on testnet.`);
  else if (res.status === 400) console.log(`Platform account ${pub} is already funded.`);
  else {
    console.error(`Friendbot failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
}
