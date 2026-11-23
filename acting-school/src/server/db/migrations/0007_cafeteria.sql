CREATE TABLE `cafe_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`category` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cafe_items_category_idx` ON `cafe_items` (`category`,`sort_order`);--> statement-breakpoint
CREATE TABLE `cafe_order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`item_id` integer,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`qty` integer NOT NULL,
	`options` text,
	FOREIGN KEY (`order_id`) REFERENCES `cafe_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `cafe_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cafe_order_items_order_idx` ON `cafe_order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `cafe_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`place` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'new' NOT NULL,
	`handled_by_id` integer,
	`cancel_reason` text,
	`created_at` integer NOT NULL,
	`on_the_way_at` integer,
	`delivered_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`handled_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cafe_orders_status_idx` ON `cafe_orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `cafe_orders_user_idx` ON `cafe_orders` (`user_id`,`created_at`);