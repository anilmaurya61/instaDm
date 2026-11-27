import { prisma } from "@/lib/db/client";
import { recordWorkerAlert } from "@/lib/ops/worker-health";

/**
 * Mark an Instagram account as needing a reconnect after Meta rejects its
 * access token (error 190 — expired, password changed, session invalidated).
 *
 * Reconnecting is the only fix, so a queue full of jobs against the same dead
 * token must not produce a queue full of identical alerts. The flag transition
 * (false → true) is the dedupe: only the caller that flips it writes the
 * OperationalEvent and worker alert. Later callers only refresh the stored
 * error message, so the reason stays current without creating new rows.
 *
 * Never throws — callers are already handling a Meta failure and losing the
 * bookkeeping must not hide the original error.
 */
export async function flagInstagramReconnect(params: {
  instagramAccountId: string;
  username?: string | null;
  workspaceId: string;
  errorMessage: string;
}): Promise<void> {
  const { instagramAccountId, username, workspaceId, errorMessage } = params;
  try {
    const { count } = await prisma.instagramAccount.updateMany({
      where: { id: instagramAccountId, needsReconnect: false },
      data: { needsReconnect: true, lastTokenError: errorMessage },
    });

    if (count === 0) {
      // Already flagged: keep the latest rejection text for diagnostics only.
      await prisma.instagramAccount.updateMany({
        where: { id: instagramAccountId },
        data: { lastTokenError: errorMessage },
      });
      return;
    }

    const handle = username ? `@${username}` : "Instagram account";
    await prisma.operationalEvent.create({
      data: {
        workspaceId,
        source: "WORKER",
        level: "ERROR",
        message: `Instagram access token rejected for ${handle}; reconnect the account. ${errorMessage}`,
        payload: { instagramAccountId, username: username ?? null },
      },
    });

    try {
      await recordWorkerAlert({
        level: "error",
        message: `Reconnect ${handle}: Instagram rejected its access token (${errorMessage})`,
        instagramAccountId,
      });
    } catch {
      // Alerts are a Redis best-effort channel; the DB flag is the source of truth.
    }
  } catch (error) {
    console.error(
      "[Instagram Token] Failed to flag account for reconnect:",
      error instanceof Error ? error.message : error
    );
  }
}
