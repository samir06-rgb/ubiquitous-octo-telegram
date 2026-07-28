(() => {
  const VALID_LICENSE_KEY = "TSG2026";
  const originalHost = "https://tvttbagljqbkcobruwnl.supabase.co";
  const originalFetch = globalThis.fetch.bind(globalThis);

  function mockValidResponse() {
    const body = JSON.stringify({
      valid: true,
      status: "active",
      success: true,
      licensed: true,
      activated: true,
      license_status: "active",
      is_valid: true,
      message: "Activated",
      error: null,
      data: { valid: true, status: "active", licensed: true, message: "Activated" }
    });
    return Promise.resolve(new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
  }

  function mockInvalidResponse() {
    const body = JSON.stringify({
      valid: false,
      status: "invalid",
      success: false,
      licensed: false,
      activated: false,
      license_status: "invalid",
      is_valid: false,
      message: "Incorrect",
      error: "Incorrect",
      data: { valid: false, status: "invalid", licensed: false, message: "Incorrect" }
    });
    return Promise.resolve(new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
  }

  async function readJsonBody(input, init) {
    const body = init && "body" in init ? init.body : undefined;
    if (typeof body === "string") return JSON.parse(body);
    if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
    if (input instanceof Request) return JSON.parse(await input.clone().text());
    return null;
  }

  function isLicenseUrl(url) {
    return url.startsWith(originalHost) ||
      url.includes("supabase.co") ||
      url.includes("license") ||
      url.includes("validate");
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input || "");
    const method = (init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (method === "POST") {
      try {
        const payload = await readJsonBody(input, init);
        if (payload && typeof payload.license_key === "string") {
          return payload.license_key === VALID_LICENSE_KEY
            ? mockValidResponse()
            : mockInvalidResponse();
        }
      } catch (error) {
        if (!isLicenseUrl(url)) return originalFetch(input, init);
        return mockInvalidResponse();
      }
    }

    return originalFetch(input, init);
  };
})();
