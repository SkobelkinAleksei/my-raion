-- 30 тестовых аккаунтов для Threads / гостей.
-- Почта сразу подтверждена, пароль один на всех, дом у Рубинштейна.
--
-- Создать (на сервере из /opt/my-raion):
--   docker exec -i sf-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/seed-demo-users.sql
--
-- Удалить:
--   docker exec -i sf-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/delete-demo-users.sql
--
-- Вход: demo1@my-raion.ru … demo30@my-raion.ru
-- Пароль: Demo1234

\set ON_ERROR_STOP on
\set demo_password 'Demo1234'

\c social_user_db

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS platform_role varchar(20);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS account_status varchar(20);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamp(0);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS terms_version varchar(32);

SELECT crypt(:'demo_password', gen_salt('bf', 10)) AS pwd_hash \gset

INSERT INTO users (
  first_name, last_name, email, number_phone, password, birthday,
  city, street_address, district_name, home_latitude, home_longitude,
  reputation, time_stamp, bio, account_status, platform_role,
  email_verified, terms_accepted_at, terms_version
)
SELECT
  names.first_name,
  'Демо',
  format('demo%s@my-raion.ru', gs.n),
  '+7999' || lpad(gs.n::text, 7, '0'),
  :'pwd_hash',
  DATE '1995-06-15',
  'Санкт-Петербург',
  'улица Рубинштейна',
  'Центральный',
  59.930400 + (gs.n * 0.000040),
  30.346400 + (gs.n * 0.000040),
  0,
  NOW()::timestamp(0),
  '[demo-seed] Тестовый аккаунт, не меняйте пароль и не удаляйте профиль',
  'ACTIVE',
  'USER',
  TRUE,
  NOW()::timestamp(0),
  '2026-08-17'
FROM generate_series(1, 30) AS gs(n)
JOIN (VALUES
  (1, 'Анна'), (2, 'Борис'), (3, 'Вера'), (4, 'Глеб'), (5, 'Дарья'),
  (6, 'Егор'), (7, 'Жанна'), (8, 'Иван'), (9, 'Кира'), (10, 'Лев'),
  (11, 'Мария'), (12, 'Никита'), (13, 'Ольга'), (14, 'Павел'), (15, 'Рита'),
  (16, 'Сергей'), (17, 'Таисия'), (18, 'Федор'), (19, 'Юлия'), (20, 'Яна'),
  (21, 'Артем'), (22, 'Виктор'), (23, 'Галина'), (24, 'Денис'), (25, 'Елена'),
  (26, 'Игорь'), (27, 'Ксения'), (28, 'Михаил'), (29, 'Наталья'), (30, 'Олег')
) AS names(n, first_name) ON names.n = gs.n
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE lower(u.email) = format('demo%s@my-raion.ru', gs.n)
);

INSERT INTO user_settings (
  user_id, search_radius, allow_dm_from_all, allow_comments_from_all,
  photo_visibility, notify_comments, notify_messages, notify_event_requests,
  notify_reputation, show_last_seen
)
SELECT u.id, 1.0, TRUE, TRUE, 'ALL', TRUE, TRUE, TRUE, TRUE, TRUE
FROM users u
WHERE u.email ~ '^demo[0-9]+@my-raion\.ru$'
  AND NOT EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = u.id);

COPY (
  SELECT id, lower(email), password
  FROM users
  WHERE email ~ '^demo[0-9]+@my-raion\.ru$'
  ORDER BY id
) TO '/tmp/myraion_demo_users.csv' WITH CSV;

\c social_security_db

ALTER TABLE IF EXISTS users_security ADD COLUMN IF NOT EXISTS platform_role varchar(20);
ALTER TABLE IF EXISTS users_security ADD COLUMN IF NOT EXISTS account_status varchar(20);
ALTER TABLE IF EXISTS users_security ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
ALTER TABLE IF EXISTS users_security ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS users_security ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT true;
ALTER TABLE IF EXISTS users_security ADD COLUMN IF NOT EXISTS locked_until timestamp;

CREATE TEMP TABLE demo_import (
  id bigint,
  email text,
  password text
);
COPY demo_import FROM '/tmp/myraion_demo_users.csv' WITH CSV;

INSERT INTO users_security (
  id, username, password, failed_attempts, enabled, account_status, platform_role, email_verified, created_at, updated_at
)
SELECT
  id,
  email,
  password,
  0,
  TRUE,
  'ACTIVE',
  'USER',
  TRUE,
  NOW()::timestamp(0),
  NOW()::timestamp(0)
FROM demo_import
ON CONFLICT (id) DO UPDATE
SET username = excluded.username,
    password = excluded.password,
    enabled = TRUE,
    account_status = 'ACTIVE',
    platform_role = 'USER',
    email_verified = TRUE,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = NOW()::timestamp(0);

SELECT COUNT(*) AS demo_accounts FROM users_security WHERE username ~ '^demo[0-9]+@my-raion\.ru$';
SELECT 'Готово. demo1@my-raion.ru … demo30@my-raion.ru  пароль Demo1234' AS result;
