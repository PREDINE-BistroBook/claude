CREATE TABLE `video_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`user_id` integer,
	`type` text NOT NULL,
	`note` text,
	`link` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `video_events_video_idx` ON `video_events` (`video_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `video_students` (
	`video_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	PRIMARY KEY(`video_id`, `student_id`),
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_students_student_idx` ON `video_students` (`student_id`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`session_id` integer,
	`title` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`raw_link` text NOT NULL,
	`notes_for_editor` text,
	`due_on` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`added_by_id` integer,
	`editor_id` integer,
	`reviewer_id` integer,
	`edited_link` text,
	`editor_notes` text,
	`taken_at` integer,
	`submitted_at` integer,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `class_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`added_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`editor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `videos_status_idx` ON `videos` (`status`,`due_on`);--> statement-breakpoint
CREATE INDEX `videos_course_idx` ON `videos` (`course_id`);--> statement-breakpoint
CREATE INDEX `videos_session_idx` ON `videos` (`session_id`);--> statement-breakpoint
CREATE INDEX `videos_added_by_idx` ON `videos` (`added_by_id`);--> statement-breakpoint
CREATE INDEX `videos_editor_idx` ON `videos` (`editor_id`);