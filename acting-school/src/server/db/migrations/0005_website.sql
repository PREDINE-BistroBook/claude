CREATE TABLE `casting_application_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`file_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `casting_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `casting_application_photos_application_idx` ON `casting_application_photos` (`application_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `casting_application_photos_file_idx` ON `casting_application_photos` (`file_id`);--> statement-breakpoint
CREATE TABLE `casting_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`gender` text,
	`date_of_birth` text NOT NULL,
	`phone` text NOT NULL,
	`phone_digits` text,
	`email` text,
	`city` text,
	`height_cm` integer,
	`languages` text NOT NULL,
	`skills` text NOT NULL,
	`experience` text,
	`links` text NOT NULL,
	`message` text,
	`guardian_name` text,
	`guardian_phone` text,
	`guardian_consent` integer DEFAULT false NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`reviewed_by_id` integer,
	`reviewed_at` integer,
	`talent_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`talent_id`) REFERENCES `talent`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `casting_applications_status_idx` ON `casting_applications` (`status`);--> statement-breakpoint
CREATE INDEX `casting_applications_created_idx` ON `casting_applications` (`created_at`);--> statement-breakpoint
CREATE INDEX `casting_applications_phone_digits_idx` ON `casting_applications` (`phone_digits`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_coaches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`name_en` text DEFAULT '' NOT NULL,
	`name_ar` text DEFAULT '' NOT NULL,
	`title_en` text DEFAULT '' NOT NULL,
	`title_ar` text DEFAULT '' NOT NULL,
	`bio_en` text DEFAULT '' NOT NULL,
	`bio_ar` text DEFAULT '' NOT NULL,
	`photo_file_id` text,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`photo_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `site_coaches_sort_idx` ON `site_coaches` (`sort_order`);--> statement-breakpoint
CREATE TABLE `site_workshops` (
	`course_id` integer PRIMARY KEY NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`title_en` text DEFAULT '' NOT NULL,
	`title_ar` text DEFAULT '' NOT NULL,
	`description_en` text DEFAULT '' NOT NULL,
	`description_ar` text DEFAULT '' NOT NULL,
	`cover_file_id` text,
	`accepting_applications` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
