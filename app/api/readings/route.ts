import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dailyReadings } from "../../../db/schema";

export const dynamic = "force-dynamic";

const SOURCE_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=36.3504&longitude=127.3845&current=temperature_2m&timezone=Asia%2FSeoul";

function kstDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeSourceTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("schema_error");
  }
  return `${value}:00+09:00`;
}

async function listReadings() {
  return getDb()
    .select()
    .from(dailyReadings)
    .orderBy(asc(dailyReadings.recordDate), asc(dailyReadings.id))
    .limit(2);
}

export async function GET() {
  try {
    return Response.json({ readings: await listReadings() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "저장된 기록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    const raw = (await response.json()) as {
      current?: { time?: unknown; temperature_2m?: unknown };
      current_units?: { temperature_2m?: unknown };
    };
    const value = raw.current?.temperature_2m;
    const unit = raw.current_units?.temperature_2m;
    if (typeof value !== "number" || typeof unit !== "string") throw new Error("schema_error");

    const now = new Date();
    const reading = {
      signalId: "daejeon-temperature",
      recordDate: kstDate(now),
      normalizedValue: value,
      unit,
      sourceName: "Open-Meteo",
      sourceUrl: SOURCE_URL,
      sourceObservedAt: normalizeSourceTime(raw.current?.time),
      fetchedAt: now.toISOString(),
      recordTimezone: "Asia/Seoul",
      rawJson: JSON.stringify(raw),
    };

    const db = getDb();
    await db.insert(dailyReadings).values(reading).onConflictDoUpdate({
      target: [dailyReadings.signalId, dailyReadings.recordDate],
      set: reading,
    });

    const allRows = await db
      .select({ id: dailyReadings.id })
      .from(dailyReadings)
      .where(eq(dailyReadings.signalId, reading.signalId))
      .orderBy(desc(dailyReadings.recordDate), desc(dailyReadings.id));
    for (const staleRow of allRows.slice(2)) {
      await db.delete(dailyReadings).where(eq(dailyReadings.id, staleRow.id));
    }

    return Response.json({ freshness: "fresh", error_code: "none", reading, readings: await listReadings() });
  } catch (error) {
    const code =
      error instanceof DOMException && error.name === "AbortError"
        ? "timeout"
        : error instanceof Error && error.message === "schema_error"
          ? "schema_error"
          : error instanceof Error && /upstream_(401|403)/.test(error.message)
            ? "auth"
            : error instanceof Error && error.message === "upstream_429"
              ? "rate_limit"
              : "offline";
    return Response.json(
      { freshness: "stale", error_code: code, message: "새 값을 받지 못해 마지막 정상 기록을 그대로 보존했습니다.", readings: await listReadings().catch(() => []) },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
