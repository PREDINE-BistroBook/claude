CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text,
	`name` text NOT NULL,
	`name_ar` text,
	`is_owner` integer DEFAULT false NOT NULL,
	`permissions` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_key_unique` ON `positions` (`key`);--> statement-breakpoint
CREATE TABLE `user_positions` (
	`user_id` integer NOT NULL,
	`position_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `position_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_positions_position_idx` ON `user_positions` (`position_id`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `role`;