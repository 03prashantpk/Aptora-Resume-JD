// Temporary file hosting via tmpfiles.org (delete + regenerate model).
// Server-only. Uploads bytes, returns a short-lived public URL.
const TMPFILES_URL = process.env.TMPFILES_URL ?? (import.meta.env as Record<string, string>).TMPFILES_URL ?? "https://tmpfiles.org/api/v1/upload";

/** Upload PDF bytes; returns a direct temp URL (or null on failure). Default expiry 6h. */
export async function uploadTemp(bytes: Uint8Array, filename: string, expireSeconds = 21_600): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
    form.append("expire", String(expireSeconds));
    const res = await fetch(TMPFILES_URL, { method: "POST", body: form });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; data?: { url?: string } };
    const url = body?.data?.url;
    if (!url) return null;
    // tmpfiles returns a page URL like https://tmpfiles.org/{id}/{name};
    // the direct-download variant inserts /dl/.
    return url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
  } catch {
    return null;
  }
}
