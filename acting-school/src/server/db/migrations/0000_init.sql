CREATE TABLE `attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`marked_by` integer,
	`marked_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `class_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_session_student_uq` ON `attendance` (`session_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `attendance_student_idx` ON `attendance` (`student_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `casting_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`casting_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`gender` text,
	`age_min` integer,
	`age_max` integer,
	`requirements` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`casting_id`) REFERENCES `castings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `casting_roles_casting_idx` ON `casting_roles` (`casting_id`);--> statement-breakpoint
CREATE TABLE `castings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`production` text,
	`casting_director` text,
	`contact_email` text,
	`contact_phone` text,
	`type` text,
	`location` text,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`submission_deadline` text,
	`shoot_start` text,
	`shoot_end` text,
	`rate` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `castings_status_idx` ON `castings` (`status`);--> statement-breakpoint
CREATE TABLE `class_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`room` text,
	`teacher_id` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`extra` integer DEFAULT false NOT NULL,
	`topic` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_sessions_course_date_time_uq` ON `class_sessions` (`course_id`,`date`,`start_time`);--> statement-breakpoint
CREATE INDEX `class_sessions_date_idx` ON `class_sessions` (`date`);--> statement-breakpoint
CREATE TABLE `course_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_slots_course_idx` ON `course_slots` (`course_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`level` text,
	`teacher_id` integer,
	`room` text,
	`capacity` integer,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`color` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `courses_status_idx` ON `courses` (`status`);--> statement-breakpoint
CREATE INDEX `courses_teacher_idx` ON `courses` (`teacher_id`);--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`status` text DEFAULT 'enrolled' NOT NULL,
	`enrolled_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_course_student_uq` ON `enrollments` (`course_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `enrollments_student_idx` ON `enrollments` (`student_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`original_name` text,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_by` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`phone` text,
	`date_of_birth` text,
	`gender` text,
	`status` text DEFAULT 'active' NOT NULL,
	`joined_on` text,
	`guardian_name` text,
	`guardian_phone` text,
	`guardian_email` text,
	`emergency_name` text,
	`emergency_phone` text,
	`photo_file_id` text,
	`media_consent` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`photo_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `students_name_idx` ON `students` (`last_name`,`first_name`);--> statement-breakpoint
CREATE INDEX `students_status_idx` ON `students` (`status`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_id` integer NOT NULL,
	`talent_id` integer NOT NULL,
	`status` text DEFAULT 'shortlisted' NOT NULL,
	`audition_at` text,
	`audition_location` text,
	`notes` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `casting_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`talent_id`) REFERENCES `talent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_role_talent_uq` ON `submissions` (`role_id`,`talent_id`);--> statement-breakpoint
CREATE INDEX `submissions_talent_idx` ON `submissions` (`talent_id`);--> statement-breakpoint
CREATE INDEX `submissions_audition_idx` ON `submissions` (`audition_at`);--> statement-breakpoint
CREATE TABLE `talent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`stage_name` text,
	`email` text,
	`phone` text,
	`date_of_birth` text,
	`gender` text,
	`playing_age_min` integer,
	`playing_age_max` integer,
	`height_cm` integer,
	`eye_color` text,
	`hair_color` text,
	`city` text,
	`languages` text NOT NULL,
	`skills` text NOT NULL,
	`showreel_url` text,
	`instagram` text,
	`headshot_file_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`represented_since` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`headshot_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `talent_student_uq` ON `talent` (`student_id`);--> statement-breakpoint
CREATE INDEX `talent_name_idx` ON `talent` (`last_name`,`first_name`);--> statement-breakpoint
CREATE INDEX `talent_status_idx` ON `talent` (`status`);--> statement-breakpoint
CREATE TABLE `talent_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`talent_id` integer NOT NULL,
	`file_id` text NOT NULL,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`talent_id`) REFERENCES `talent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `talent_photos_talent_idx` ON `talent_photos` (`talent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `talent_photos_talent_file_uq` ON `talent_photos` (`talent_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`phone` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);