import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getEncryptionKeyHex,
  getMetaGraphApiVersion,
  getMissingInstagramOAuthEnv,
  requireEnv,
} from "../lib/env";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("environment helpers", () => {
  it("requires missing variables", () => {
    expect(() => requireEnv("MISSING_TEST_ENV")).toThrow(
      "MISSING_TEST_ENV environment variable is required"
    );
  });

  it("validates the encryption key format", () => {
    vi.stubEnv("ENCRYPTION_KEY", "not-hex");
    expect(() => getEncryptionKeyHex()).toThrow(
      "ENCRYPTION_KEY must be a 32-byte hex string"
    );
  });

  it("defaults Meta Graph API version in one place", () => {
    expect(getMetaGraphApiVersion()).toBe("v26.0");
  });

  it("flags an Instagram app id pasted with its variable name attached", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
    vi.stubEnv(
      "ENCRYPTION_KEY",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
    vi.stubEnv("INSTAGRAM_APP_ID", "INSTAGRAM_APP_ID=1495314182408497");

    expect(getMissingInstagramOAuthEnv()).toEqual(["INSTAGRAM_APP_ID"]);
  });

  it("accepts a numeric Instagram app id", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
    vi.stubEnv(
      "ENCRYPTION_KEY",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
    vi.stubEnv("INSTAGRAM_APP_ID", "1495314182408497");

    expect(getMissingInstagramOAuthEnv()).toEqual([]);
  });
});
