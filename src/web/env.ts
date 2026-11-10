/** True when built as a self-contained hosted page with no server behind it. */
export const STANDALONE = import.meta.env.VITE_STANDALONE === "1";

/** Copy text; resolves false if the browser refuses the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
