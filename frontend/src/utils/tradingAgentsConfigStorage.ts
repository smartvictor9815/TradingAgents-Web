/**
 * Persist Alpha Vantage API key with salt + AES-GCM (PBKDF2-derived key).
 * Pepper is fixed in bundle — this is obfuscation, not strong protection against a determined attacker.
 */
import type { DataVendorKey, DataVendorValue } from "../config/dataVendors";

export const TRADING_AGENTS_CONFIG_STORAGE_KEY = "tradingagents-config";

const PEPPER = "tradingagents:av-api-key:v1";
const PBKDF2_ITERATIONS = 210_000;

export type AlphaVantageKeySealedV1 = {
  v: 1;
  salt: string;
  iv: string;
  data: string;
};

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sealAlphaVantageApiKey(plain: string): Promise<AlphaVantageKeySealedV1> {
  const enc = new TextEncoder();
  const saltBuf = new ArrayBuffer(16);
  const salt = new Uint8Array(saltBuf);
  crypto.getRandomValues(salt);
  const ivBuf = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuf);
  crypto.getRandomValues(iv);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(PEPPER),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plain),
  );

  return {
    v: 1,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(ciphertext)),
  };
}

export async function openAlphaVantageApiKey(
  sealed: AlphaVantageKeySealedV1,
): Promise<string | undefined> {
  try {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const salt = b64ToBytes(sealed.salt);
    const iv = b64ToBytes(sealed.iv);
    const data = b64ToBytes(sealed.data);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(PEPPER),
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return dec.decode(plainBuf);
  } catch (e) {
    console.error("Failed to decrypt Alpha Vantage API key:", e);
    return undefined;
  }
}

function isSealedV1(x: unknown): x is AlphaVantageKeySealedV1 {
  if (!x || typeof x !== "object") return false;
  const o = x as AlphaVantageKeySealedV1;
  return (
    o.v === 1 &&
    typeof o.salt === "string" &&
    typeof o.iv === "string" &&
    typeof o.data === "string"
  );
}

/** Sync check for initial UI before async decrypt (avoid showing legacy + sealed as plain). */
export function parseHasSealedAlphaVantageKey(parsed: Record<string, unknown>): boolean {
  return isSealedV1(parsed.alphaVantageApiKeySealed);
}

/** Resolve plaintext key from parsed localStorage JSON (sealed v1 or legacy plain field). */
export async function decryptAlphaVantageKeyFromParsed(
  parsed: Record<string, unknown>,
): Promise<string | undefined> {
  if (isSealedV1(parsed.alphaVantageApiKeySealed)) {
    const opened = await openAlphaVantageApiKey(parsed.alphaVantageApiKeySealed);
    if (opened?.trim()) return opened.trim();
  }
  const legacy = parsed.alphaVantageApiKey;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return undefined;
}

export type PersistableTradingAgentsConfig = {
  outputLanguage: string;
  analysts: string[];
  researchDepth: string;
  llmProvider: string;
  alphaVantageApiKey?: string;
  dataVendors: Record<DataVendorKey, DataVendorValue>;
};

/** JSON for localStorage: never stores plaintext API key when non-empty. */
export async function buildTradingAgentsConfigJson(
  config: PersistableTradingAgentsConfig,
): Promise<string> {
  const { alphaVantageApiKey, ...rest } = config;
  const payload: Record<string, unknown> = { ...rest };
  const trimmed = alphaVantageApiKey?.trim();
  if (trimmed) {
    payload.alphaVantageApiKeySealed = await sealAlphaVantageApiKey(trimmed);
  }
  return JSON.stringify(payload);
}
