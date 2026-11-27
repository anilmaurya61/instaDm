import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { refreshLongLivedToken, TokenExpiredError } from "@/lib/meta/client";

const DAYS_BEFORE_EXPIRY = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store, must-revalidate" },
      }
    );
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + DAYS_BEFORE_EXPIRY);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [usageReset, accountsToRefresh] = await Promise.all([
    prisma.workspace.updateMany({
      where: { usagePeriodStart: { lt: monthStart } },
      data: {
        usagePeriodStart: monthStart,
        dmsSentThisPeriod: 0,
      },
    }),
    prisma.instagramAccount.findMany({
      where: {
        accessToken: { not: "" },
        tokenExpiresAt: {
          not: null,
          lte: cutoffDate,
        },
      },
      select: {
        id: true,
        workspaceId: true,
        username: true,
        accessToken: true,
      },
    }),
  ]);

  const results: Array<{
    instagramAccountId: string;
    username: string;
    status: "refreshed" | "failed";
    error?: string;
  }> = [];

  for (const account of accountsToRefresh) {
    try {
      const currentToken = decryptToken(account.accessToken);
      const { accessToken: newToken, expiresIn } =
        await refreshLongLivedToken(currentToken);
      const encryptedToken = encryptToken(newToken);
      const newExpiry = new Date(Date.now() + expiresIn * 1000);

      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: {
          accessToken: encryptedToken,
          tokenExpiresAt: newExpiry,
          needsReconnect: false,
          lastTokenError: null,
        },
      });

      results.push({
        instagramAccountId: account.id,
        username: account.username,
        status: "refreshed",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await prisma.operationalEvent.create({
        data: {
          workspaceId: account.workspaceId,
          source: "TOKEN_REFRESH",
          level: "ERROR",
          message: `Token refresh failed for @${account.username}: ${errorMessage}`,
          payload: {
            instagramAccountId: account.id,
            username: account.username,
          },
        },
      });

      // Error 190 means this token can never be refreshed — only a new OAuth
      // grant fixes it. Flag it so the dashboard asks the user to reconnect
      // instead of the worker discovering it one failed DM at a time.
      if (err instanceof TokenExpiredError) {
        await prisma.instagramAccount.update({
          where: { id: account.id },
          data: { needsReconnect: true, lastTokenError: errorMessage },
        });
      }

      results.push({
        instagramAccountId: account.id,
        username: account.username,
        status: "failed",
        error: errorMessage,
      });
    }
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        totalProcessed: accountsToRefresh.length,
        workspacesReset: usageReset.count,
        results,
      },
    },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
