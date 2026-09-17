CREATE TABLE `daily_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`signal_id` text NOT NULL,
	`record_date` text NOT NULL,
	`normalized_value` real NOT NULL,
	`unit` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`source_observed_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`record_timezone` text DEFAULT 'Asia/Seoul' NOT NULL,
	`raw_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_daily_readings_signal_date` ON `daily_readings` (`signal_id`,`record_date`);