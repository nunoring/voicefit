-- ============================================================
-- 0002_commerce_pack_and_missing_columns.sql
-- idempotent — 재실행해도 안전
--
-- 배경: 0001_init.sql에 posts.post_type / content_json /
-- publish_platform / published_url 컬럼이 빠져 있었음(코드는 이미
-- 사용 중이던 드리프트). commerce_pack 글 유형 작업 중 발견해 같이 정리.
-- ============================================================

alter table public.posts add column if not exists post_type text;
alter table public.posts add column if not exists content_json jsonb;
alter table public.posts add column if not exists publish_platform text;
alter table public.posts add column if not exists published_url text;

alter table public.posts drop constraint if exists posts_post_type_check;
alter table public.posts add constraint posts_post_type_check
  check (post_type is null or post_type in ('product', 'daily', 'review', 'coupang', 'commerce_pack'));

alter table public.posts drop constraint if exists posts_publish_platform_check;
alter table public.posts add constraint posts_publish_platform_check
  check (publish_platform is null or publish_platform in ('naver', 'tistory', 'manual'));
