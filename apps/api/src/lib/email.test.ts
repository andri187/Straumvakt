import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "./email";
import type { Env } from "../bindings";

function makeEnv(apiKey?: string): Env {
  // Cast through unknown — the test only needs RESEND_API_KEY; other
  // bindings are not touched by sendEmail and don't need real values.
  return { RESEND_API_KEY: apiKey } as unknown as Env;
}

describe("sendEmail", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fails OPEN with a warn when RESEND_API_KEY is missing", async () => {
    const result = await sendEmail(makeEnv(undefined), {
      to: "x@example.com",
      subject: "test",
      html: "<p>hi</p>",
    });
    expect(result).toEqual({ ok: false, reason: "binding_missing" });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the correct body to resend.com/emails with default From", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "abc123" }), { status: 200 }),
    );
    const result = await sendEmail(makeEnv("re_test"), {
      to: "x@example.com",
      subject: "test",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(result).toEqual({ ok: true, id: "abc123" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.from).toBe("Straumvakt <no-reply@straumvakt.org>");
    expect(body.to).toEqual(["x@example.com"]);
    expect(body.subject).toBe("test");
    expect(body.html).toBe("<p>hi</p>");
    expect(body.text).toBe("hi");
  });

  it("accepts an array of recipients", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "id_multi" }), { status: 200 }),
    );
    await sendEmail(makeEnv("re_test"), {
      to: ["a@example.com", "b@example.com"],
      subject: "test",
      html: "<p>hi</p>",
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1]?.body as string) ?? "{}");
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("forwards a custom from address when given", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "id_from" }), { status: 200 }),
    );
    await sendEmail(makeEnv("re_test"), {
      to: "x@example.com",
      from: "alerts@straumvakt.org",
      subject: "test",
      html: "<p>hi</p>",
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1]?.body as string) ?? "{}");
    expect(body.from).toBe("alerts@straumvakt.org");
  });

  it("forwards tags when given", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "id_tags" }), { status: 200 }),
    );
    await sendEmail(makeEnv("re_test"), {
      to: "x@example.com",
      subject: "test",
      html: "<p>hi</p>",
      tags: [{ name: "category", value: "invite" }],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1]?.body as string) ?? "{}");
    expect(body.tags).toEqual([{ name: "category", value: "invite" }]);
  });

  it("returns send_failed with status on 4xx", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ name: "validation_error", message: "Invalid `to`" }),
        { status: 422 },
      ),
    );
    const result = await sendEmail(makeEnv("re_test"), {
      to: "x@example.com",
      subject: "test",
      html: "<p>hi</p>",
    });
    expect(result.ok).toBe(false);
    if (result.ok === false && result.reason === "send_failed") {
      expect(result.status).toBe(422);
      expect(result.error).toContain("validation_error");
    } else {
      throw new Error("expected send_failed");
    }
  });

  it("returns send_failed on fetch throw", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await sendEmail(makeEnv("re_test"), {
      to: "x@example.com",
      subject: "test",
      html: "<p>hi</p>",
    });
    expect(result.ok).toBe(false);
    if (result.ok === false && result.reason === "send_failed") {
      expect(result.status).toBe(0);
      expect(result.error).toBe("ECONNRESET");
    } else {
      throw new Error("expected send_failed");
    }
  });

  it("returns send_failed when response has no id", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const result = await sendEmail(makeEnv("re_test"), {
      to: "x@example.com",
      subject: "test",
      html: "<p>hi</p>",
    });
    expect(result.ok).toBe(false);
    if (result.ok === false && result.reason === "send_failed") {
      expect(result.error).toBe("missing_response_id");
    } else {
      throw new Error("expected send_failed");
    }
  });
});
