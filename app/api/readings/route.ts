import { asc, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { dailyReadings } from "../../../db/schema";

export const dynamic = "force-dynamic";

const SOURCE_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=36.3504&longitude=127.3845&current_weather=true&timezone=Asia%2FSeoul";

function kstDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
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

export async function POST(request: Request) {
  let stage = "validate";
  try {
    const body = (await request.json()) as { source_payload?: unknown };
    if (!body || typeof body.source_payload !== "object" || body.source_payload === null) throw new Error("schema_error");
    const raw = body.source_payload as {
      current_weather?: { time?: unknown; temperature?: unknown };
      current_weather_units?: { temperature?: unknown };
    };
    const value = raw.current_weather?.temperature;
    const unit = raw.current_weather_units?.temperature ?? "°C";
    if (typeof value !== "number" || typeof unit !== "string") throw new Error("schema_error");

    const now = new Date();
    const reading = {
      signalId: "daejeon-temperature",
      recordDate: kstDate(now),
      normalizedValue: value,
      unit,
      sourceName: "Open-Meteo",
      sourceUrl: SOURCE_URL,
      sourceObservedAt: normalizeSourceTime(raw.current_weather?.time),
      fetchedAt: now.toISOString(),
      recordTimezone: "Asia/Seoul",
      rawJson: JSON.stringify(raw),
    };

    stage = "store";
    if (!env.DB) throw new Error("DB binding unavailable");
    await env.DB.prepare(`
      INSERT INTO daily_readings
        (signal_id, record_date, normalized_value, unit, source_name, source_url,
         source_observed_at, fetched_at, record_timezone, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signal_id, record_date) DO UPDATE SET
        normalized_value = excluded.normalized_value,
        unit = excluded.unit,
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        source_observed_at = excluded.source_observed_at,
        fetched_at = excluded.fetched_at,
        record_timezone = excluded.record_timezone,
        raw_json = excluded.raw_json
    `).bind(
      reading.signalId,
      reading.recordDate,
      reading.normalizedValue,
      reading.unit,
      reading.sourceName,
      reading.sourceUrl,
      reading.sourceObservedAt,
      reading.fetchedAt,
      reading.recordTimezone,
      reading.rawJson,
    ).run();

    const db = getDb();
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
    console.error("readings_post_failed", {
      stage,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    const code =
      error instanceof Error && error.message === "schema_error"
          ? "schema_error"
          : "offline";
    return Response.json(
      { freshness: "stale", error_code: code, message: `${stage} 단계에서 새 값을 받지 못해 마지막 정상 기록을 그대로 보존했습니다.`, readings: await listReadings().catch(() => []) },
      { status: 502 },
    );
  }
}
