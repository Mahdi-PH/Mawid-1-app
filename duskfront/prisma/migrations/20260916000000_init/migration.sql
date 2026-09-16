-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "password_hash" TEXT,
    "is_guest" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),
    "banned_until" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(20) NOT NULL,
    "avatar_id" VARCHAR(40) NOT NULL DEFAULT 'avatar_default',
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "shards" INTEGER NOT NULL DEFAULT 0,
    "rank_rating" INTEGER NOT NULL DEFAULT 1000,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'ar',

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "device_info" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_settings" (
    "user_id" UUID NOT NULL,
    "graphics" JSONB NOT NULL,
    "audio" JSONB NOT NULL,
    "controls" JSONB NOT NULL,
    "accessibility" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "player_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "class_progress" (
    "user_id" UUID NOT NULL,
    "class_key" VARCHAR(32) NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "mastery_level" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "class_progress_pkey" PRIMARY KEY ("user_id","class_key")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "class_key" VARCHAR(32),
    "price_shards" INTEGER NOT NULL,
    "rarity" VARCHAR(16) NOT NULL,
    "name_key_ar" VARCHAR(80) NOT NULL,
    "name_key_en" VARCHAR(80) NOT NULL,
    "color_primary" VARCHAR(9) NOT NULL,
    "color_accent" VARCHAR(9) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_inventory" (
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_inventory_pkey" PRIMARY KEY ("user_id","item_id")
);

-- CreateTable
CREATE TABLE "loadouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "class_key" VARCHAR(32) NOT NULL,
    "slot" SMALLINT NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "loadouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "mode" VARCHAR(24) NOT NULL,
    "map_key" VARCHAR(40) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "winner_team" SMALLINT,
    "win_reason" VARCHAR(32),
    "server_version" VARCHAR(24) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team" SMALLINT NOT NULL,
    "class_key" VARCHAR(32) NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "damage_dealt" INTEGER NOT NULL DEFAULT 0,
    "lumen_generated" INTEGER NOT NULL DEFAULT 0,
    "mirrors_placed" INTEGER NOT NULL DEFAULT 0,
    "xp_earned" INTEGER NOT NULL DEFAULT 0,
    "shards_earned" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("match_id","user_id")
);

-- CreateTable
CREATE TABLE "player_stats" (
    "user_id" UUID NOT NULL,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "time_in_sun_s" INTEGER NOT NULL DEFAULT 0,
    "time_in_dark_s" INTEGER NOT NULL DEFAULT 0,
    "crawlers_destroyed" INTEGER NOT NULL DEFAULT 0,
    "wells_captured" INTEGER NOT NULL DEFAULT 0,
    "mirror_reveals" INTEGER NOT NULL DEFAULT 0,
    "last_win_day" VARCHAR(10),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "player_stats_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "target" INTEGER NOT NULL,
    "reward_shards" INTEGER NOT NULL,
    "metric" VARCHAR(40) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_achievements" (
    "user_id" UUID NOT NULL,
    "achievement_id" UUID NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "unlocked_at" TIMESTAMPTZ(3),

    CONSTRAINT "player_achievements_pkey" PRIMARY KEY ("user_id","achievement_id")
);

-- CreateTable
CREATE TABLE "daily_missions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "target" INTEGER NOT NULL,
    "reward_xp" INTEGER NOT NULL,
    "reward_shards" INTEGER NOT NULL,
    "metric" VARCHAR(40) NOT NULL,

    CONSTRAINT "daily_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_missions" (
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "assigned_on" DATE NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "player_missions_pkey" PRIMARY KEY ("user_id","mission_id","assigned_on")
);

-- CreateTable
CREATE TABLE "campaign_saves" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "slot" SMALLINT NOT NULL,
    "mission_index" INTEGER NOT NULL,
    "checkpoint" JSONB NOT NULL,
    "difficulty" VARCHAR(16) NOT NULL,
    "play_time_s" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_saves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "ref_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "user_id" UUID NOT NULL,
    "friend_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("user_id","friend_id")
);

-- CreateTable
CREATE TABLE "player_reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reported_id" UUID NOT NULL,
    "match_id" UUID,
    "reason" VARCHAR(32) NOT NULL,
    "details" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_banned_until_idx" ON "users"("banned_until");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_display_name_key" ON "profiles"("display_name");

-- CreateIndex
CREATE INDEX "profiles_rank_rating_idx" ON "profiles"("rank_rating" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_expires_at_idx" ON "refresh_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_key_key" ON "catalog_items"("key");

-- CreateIndex
CREATE INDEX "catalog_items_type_price_shards_idx" ON "catalog_items"("type", "price_shards");

-- CreateIndex
CREATE UNIQUE INDEX "loadouts_user_id_class_key_slot_key" ON "loadouts"("user_id", "class_key", "slot");

-- CreateIndex
CREATE INDEX "matches_ended_at_idx" ON "matches"("ended_at");

-- CreateIndex
CREATE INDEX "matches_mode_ended_at_idx" ON "matches"("mode", "ended_at");

-- CreateIndex
CREATE INDEX "match_participants_user_id_idx" ON "match_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_key_key" ON "achievements"("key");

-- CreateIndex
CREATE UNIQUE INDEX "daily_missions_key_key" ON "daily_missions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_saves_user_id_slot_key" ON "campaign_saves"("user_id", "slot");

-- CreateIndex
CREATE INDEX "currency_ledger_user_id_created_at_idx" ON "currency_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "friendships_friend_id_status_idx" ON "friendships"("friend_id", "status");

-- CreateIndex
CREATE INDEX "player_reports_reported_id_created_at_idx" ON "player_reports"("reported_id", "created_at");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_settings" ADD CONSTRAINT "player_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_progress" ADD CONSTRAINT "class_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_inventory" ADD CONSTRAINT "player_inventory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_inventory" ADD CONSTRAINT "player_inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadouts" ADD CONSTRAINT "loadouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_missions" ADD CONSTRAINT "player_missions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_missions" ADD CONSTRAINT "player_missions_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "daily_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_saves" ADD CONSTRAINT "campaign_saves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_ledger" ADD CONSTRAINT "currency_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_friend_id_fkey" FOREIGN KEY ("friend_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- قيود CHECK المطلوبة في المواصفات (لا يولّدها Prisma تلقائيًا)
-- CHECK constraints required by the spec — Prisma does not emit these itself.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_shards_non_negative" CHECK ("shards" >= 0);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_level_range" CHECK ("level" >= 1 AND "level" <= 50);
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_type_allowed"
  CHECK ("type" IN ('skin','emblem','banner','emote'));
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_price_non_negative" CHECK ("price_shards" >= 0);
ALTER TABLE "loadouts" ADD CONSTRAINT "loadouts_slot_range" CHECK ("slot" BETWEEN 1 AND 3);
ALTER TABLE "campaign_saves" ADD CONSTRAINT "campaign_saves_slot_range" CHECK ("slot" BETWEEN 1 AND 3);
ALTER TABLE "campaign_saves" ADD CONSTRAINT "campaign_saves_version_positive" CHECK ("version" >= 1);
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_status_allowed"
  CHECK ("status" IN ('pending','accepted','blocked'));
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_not_self" CHECK ("user_id" <> "friend_id");
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_team_range" CHECK ("team" IN (0,1));
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_range"
  CHECK ("winner_team" IS NULL OR "winner_team" IN (0,1));
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_not_self" CHECK ("reporter_id" <> "reported_id");
