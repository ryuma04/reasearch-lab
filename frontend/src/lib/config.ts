/** Centralised runtime configuration. Only NEXT_PUBLIC_* values are readable in the browser. */

const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export const API_BASE_URL = rawBase.replace(/\/+$/, "");

/**
 * Development-only demo transport. Hard-disabled in production builds so a
 * deployed app can never show sample data as real results.
 */
export const USE_MOCKS =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_ORIGIN ?? "").replace(/\/+$/, "");

/** Client-side validation limits. Backend limits are authoritative; see FRONTEND_INTEGRATION_NOTES.md. */
export const LIMITS = {
  paperMaxBytes: 50 * 1024 * 1024,
  datasetMaxBytes: 500 * 1024 * 1024,
  maxPapers: 2,
  titleMax: 120,
  noteMax: 2000,
  questionMax: 500,
  instructionMax: 1000,
} as const;

export const REQUEST_TIMEOUT_MS = 30_000;
