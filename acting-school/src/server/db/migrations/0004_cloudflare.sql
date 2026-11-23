CREATE TABLE `file_chunks` (
	`storage_key` text NOT NULL,
	`seq` integer NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`storage_key`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `login_failures` (
	`key` text PRIMARY KEY NOT NULL,
	`email` text,
	`count` integer NOT NULL,
	`first_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_failures_email_idx` ON `login_failures` (`email`);--> statement-breakpoint
ALTER TABLE `leads` ADD `phone_digits` text;--> statement-breakpoint
CREATE INDEX `leads_phone_digits_idx` ON `leads` (`phone_digits`);--> statement-breakpoint
ALTER TABLE `students` ADD `phone_digits` text;--> statement-breakpoint
CREATE INDEX `students_phone_digits_idx` ON `students` (`phone_digits`);