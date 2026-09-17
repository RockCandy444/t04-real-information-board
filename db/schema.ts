import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const dailyReadings = sqliteTable(
  "daily_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    signalId: text("signal_id").notNull(),
    recordDate: text("record_date").notNull(),
    normalizedValue: real("normalized_value").notNull(),
    unit: text("unit").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceObservedAt: text("source_observed_at").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    recordTimezone: text("record_timezone").notNull().default("Asia/Seoul"),
    rawJson: text("raw_json").notNull(),
  },
  (table) => [
    uniqueIndex("idx_daily_readings_signal_date").on(
      table.signalId,
      table.recordDate,
    ),
  ],
);
