ALTER TABLE `courses` ADD `created_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `students` ADD `created_by` integer REFERENCES users(id);