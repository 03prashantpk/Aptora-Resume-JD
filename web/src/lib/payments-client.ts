// Client-side PayU checkout: asks our init route for a hashed transaction, then
// submits a hidden form straight to the PayU gateway (standard redirect flow).
// No secrets in the client — only the gateway URL + pre-hashed form params.
export type PlanCode = "TOPUP" | "PRO";

export interface CheckoutMeta {
  name?: string;
  email?: string;
}

export async function startCheckout(plan: PlanCode, meta: CheckoutMeta = {}): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/payments/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, name: meta.name, email: meta.email }),
    });
  } catch {
    throw new Error("Checkout is unreachable — check your connection.");
  }
  if (!res.ok) {
    let message = "Checkout is unavailable right now.";
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      message = j.error || j.message || message;
    } catch { /* keep default */ }
    throw new Error(message);
  }
  const { gatewayUrl, params } = (await res.json()) as { gatewayUrl: string; params: Record<string, string> };
  if (!gatewayUrl || !params) throw new Error("Checkout could not start. Please try again.");

  // Hidden form POST — the only way the gateway accepts a transaction request.
  const form = document.createElement("form");
  form.method = "POST";
  form.action = gatewayUrl;
  for (const [k, v] of Object.entries(params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = String(v);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
