-- Удаляет тестовые demo1@…demo30@ и их следы в сервисах.
--
--   docker exec -i sf-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/delete-demo-users.sql

\set ON_ERROR_STOP on

\c social_user_db
COPY (
  SELECT id FROM users WHERE email ~ '^demo[0-9]+@my-raion\.ru$' ORDER BY id
) TO '/tmp/myraion_demo_ids.csv' WITH CSV;

\c social_security_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM demo_ids)
   OR user_id IN (SELECT id FROM users_security WHERE username ~ '^demo[0-9]+@my-raion\.ru$');
DELETE FROM users_security
 WHERE id IN (SELECT id FROM demo_ids)
    OR username ~ '^demo[0-9]+@my-raion\.ru$';

\c social_event_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM event_user_reputation_votes
 WHERE voter_id IN (SELECT id FROM demo_ids) OR target_id IN (SELECT id FROM demo_ids);
DELETE FROM event_photos
 WHERE event_id IN (SELECT id FROM events WHERE organizer_id IN (SELECT id FROM demo_ids));
DELETE FROM event_participants
 WHERE event_id IN (SELECT id FROM events WHERE organizer_id IN (SELECT id FROM demo_ids));
DELETE FROM events WHERE organizer_id IN (SELECT id FROM demo_ids);
DELETE FROM event_participants WHERE user_id IN (SELECT id FROM demo_ids);

\c social_friend_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM friends
 WHERE user_id_1 IN (SELECT id FROM demo_ids) OR user_id_2 IN (SELECT id FROM demo_ids);
DELETE FROM friends_block_list
 WHERE author_id IN (SELECT id FROM demo_ids) OR blocked_user_id IN (SELECT id FROM demo_ids);
DELETE FROM user_references WHERE id IN (SELECT id FROM demo_ids);

\c social_post_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM post_views WHERE user_id IN (SELECT id FROM demo_ids)
   OR post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM demo_ids));
DELETE FROM post_photos WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM demo_ids));
DELETE FROM posts WHERE author_id IN (SELECT id FROM demo_ids);

\c social_comment_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM comment_votes
 WHERE user_id IN (SELECT id FROM demo_ids)
    OR comment_id IN (SELECT id FROM comments WHERE author_id IN (SELECT id FROM demo_ids));
DELETE FROM comments WHERE author_id IN (SELECT id FROM demo_ids);

\c social_like_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM like_post WHERE user_id IN (SELECT id FROM demo_ids);

\c social_notification_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM notifications WHERE user_id IN (SELECT id FROM demo_ids);
DELETE FROM user_notification_settings WHERE user_id IN (SELECT id FROM demo_ids);
DELETE FROM push_subscriptions WHERE user_id IN (SELECT id FROM demo_ids);

\c social_chat_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM chat_poll_votes WHERE user_id IN (SELECT id FROM demo_ids);
DELETE FROM chat_user_prefs WHERE user_id IN (SELECT id FROM demo_ids);
DELETE FROM chat_participants WHERE user_id IN (SELECT id FROM demo_ids);

\c social_user_db
CREATE TEMP TABLE demo_ids (id bigint);
COPY demo_ids FROM '/tmp/myraion_demo_ids.csv' WITH CSV;
DELETE FROM email_otps WHERE email ~ '^demo[0-9]+@my-raion\.ru$';
DELETE FROM photo_likes
 WHERE liker_id IN (SELECT id FROM demo_ids) OR owner_id IN (SELECT id FROM demo_ids);
DELETE FROM gallery_photos WHERE owner_id IN (SELECT id FROM demo_ids);
DELETE FROM photo_albums WHERE owner_id IN (SELECT id FROM demo_ids);
DELETE FROM avatar_history WHERE user_id IN (SELECT id FROM demo_ids);
DELETE FROM user_settings WHERE user_id IN (SELECT id FROM demo_ids);
DELETE FROM users WHERE id IN (SELECT id FROM demo_ids)
   OR email ~ '^demo[0-9]+@my-raion\.ru$';

SELECT 'Тестовые demo-аккаунты удалены' AS result;
