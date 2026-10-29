const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY_CHARS = 8_000_000;

export async function analyzeTransaction(
  request: Request,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResult({ error: "Method not allowed" }, 405);
  }
  if (!apiKey) {
    return jsonResult({ error: "Claude API key not configured" }, 500);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return jsonResult({ error: "Image is too large" }, 413);
  }
  let body: { imageData?: unknown; mimeType?: unknown };
  try {
    body = JSON.parse(text) as { imageData?: unknown; mimeType?: unknown };
  } catch {
    return jsonResult({ error: "Expected JSON" }, 400);
  }
  if (typeof body.imageData !== "string" || typeof body.mimeType !== "string" || !body.imageData || !body.mimeType) {
    return jsonResult({ error: "Missing imageData or mimeType" }, 400);
  }
  if (!/^image\/[a-zA-Z0-9.+-]+$/.test(body.mimeType)) {
    return jsonResult({ error: "Unsupported image type" }, 400);
  }

  let response: Response;
  try {
    response = await fetchImpl(CLAUDE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: body.mimeType, data: body.imageData },
              },
              {
                type: "text",
                text: `Analyze this bank transaction screenshot. Extract ALL transactions visible and return ONLY a JSON array with NO other text, explanation, or markdown. 

Format: [{"store": "merchant or description", "amount": number (positive value, no dollar sign), "date": "YYYY-MM-DD"}]

Rules:
- Extract EVERY transaction you see
- "store" should be the merchant name or transaction description
- "amount" must be a positive number (e.g., 5.39, not -5.39)
- "date" in YYYY-MM-DD format - ALWAYS use 2026 as the year unless a different year is explicitly shown
- If only month and day are visible, use 2026 as the year
- Return ONLY the JSON array, no other text`,
              },
            ],
          },
        ],
      }),
    });
  } catch {
    return jsonResult({ error: "Failed to process image" }, 500);
  }

  let data: { content?: Array<{ text?: string }>; error?: { message?: string } };
  try {
    data = (await response.json()) as { content?: Array<{ text?: string }>; error?: { message?: string } };
  } catch {
    return jsonResult({ error: "Failed to process image" }, 500);
  }
  if (!response.ok) {
    return jsonResult({ error: data.error?.message || "Claude API request failed" }, response.status);
  }

  try {
    let responseText = data.content?.[0]?.text?.trim() ?? "";
    responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const transactions = JSON.parse(responseText) as unknown;
    if (!Array.isArray(transactions)) {
      return jsonResult({ error: "Failed to process image" }, 500);
    }
    return jsonResult({ transactions }, 200);
  } catch {
    return jsonResult({ error: "Failed to process image" }, 500);
  }
}

function jsonResult(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
