CREATE TABLE `casting_opportunities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`project_type` text,
	`roles` text,
	`location` text,
	`deadline` text,
	`contact` text,
	`link` text,
	`source` text,
	`asks_for_payment` integer DEFAULT false NOT NULL,
	`involves_minors` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`casting_id` integer,
	`created_by_id` integer,
	`reviewed_by_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`casting_id`) REFERENCES `castings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `casting_opportunities_status_idx` ON `casting_opportunities` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `casting_opportunity_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`file_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `casting_opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `casting_opportunity_files_opp_idx` ON `casting_opportunity_files` (`opportunity_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `casting_opportunity_files_file_idx` ON `casting_opportunity_files` (`file_id`);