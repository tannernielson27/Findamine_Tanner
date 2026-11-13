import { fetchMe } from "@/lib/hooks/use-me";

/**
 * True/false from /auth/me, or null when it can't be told. Used to keep a
 * child's photos and recordings on the device (COPPA): the file isn't even
 * sent. If the role can't be read the file is sent and the server discards
 * it for a child.
 */
export async function isChildAccount(): Promise<boolean | null> {
  try {
    const data = await fetchMe();
    if (!data) return null;
    return data.user?.role === "child";
  } catch {
    return null;
  }
}
