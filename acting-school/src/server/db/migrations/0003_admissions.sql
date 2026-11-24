CREATE TABLE `interviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`scheduled_at` text NOT NULL,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`room` text,
	`interviewer_id` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scores` text NOT NULL,
	`strengths` text,
	`areas_to_work` text,
	`notes` text,
	`recommendation` text,
	`recommended_level` text,
	`recommended_course_id` integer,
	`recorded_by_id` integer,
	`recorded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recommended_course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `interviews_lead_idx` ON `interviews` (`lead_id`);--> statement-breakpoint
CREATE INDEX `interviews_scheduled_idx` ON `interviews` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `lead_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`type` text NOT NULL,
	`body` text,
	`meta` text,
	`created_by_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `lead_activities_lead_idx` ON `lead_activities` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`date_of_birth` text,
	`gender` text,
	`city` text,
	`guardian_name` text,
	`guardian_phone` text,
	`source` text DEFAULT 'other' NOT NULL,
	`source_detail` text,
	`interest` text,
	`experience` text,
	`preferred_course_id` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`lost_reason` text,
	`assigned_to_id` integer,
	`next_follow_up_on` text,
	`student_id` integer,
	`created_by_id` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`preferred_course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_follow_up_idx` ON `leads` (`next_follow_up_on`);--> statement-breakpoint
CREATE INDEX `leads_phone_idx` ON `leads` (`phone`);