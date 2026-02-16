import { describe, expect, it } from "vitest";
import { findAuthAuthorizeUrl } from "../src/core/codex-oauth.js";

describe("codex oauth url extraction", () => {
  it("extracts auth.openai.com authorize url", () => {
    const text =
      "If browser did not open use: https://auth.openai.com/oauth/authorize?x=1&state=abc123";
    expect(findAuthAuthorizeUrl(text)).toBe(
      "https://auth.openai.com/oauth/authorize?x=1&state=abc123"
    );
  });

  it("ignores localhost callback urls", () => {
    const text = "OAuth link: http://localhost:1455/success?id_token=abc";
    expect(findAuthAuthorizeUrl(text)).toBeNull();
  });

  it("strips trailing punctuation", () => {
    const text = "Open this: https://auth.openai.com/oauth/authorize?state=abc.";
    expect(findAuthAuthorizeUrl(text)).toBe("https://auth.openai.com/oauth/authorize?state=abc");
  });
});

