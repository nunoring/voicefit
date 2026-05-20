-- ============================================================
-- 0001_init.sql
-- ============================================================

-- ── voice_profiles ──────────────────────────────────────────
create table public.voice_profiles (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        references auth.users on delete cascade,
  name                  text        not null,
  source_text           text        not null,
  profile_json          jsonb       not null,
  reusable_system_prompt text       not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.voice_profiles enable row level security;

create policy "voice_profiles: owner select"
  on public.voice_profiles for select
  using (user_id = auth.uid());

create policy "voice_profiles: owner insert"
  on public.voice_profiles for insert
  with check (user_id = auth.uid());

create policy "voice_profiles: owner update"
  on public.voice_profiles for update
  using (user_id = auth.uid());

create policy "voice_profiles: owner delete"
  on public.voice_profiles for delete
  using (user_id = auth.uid());

-- ── posts ────────────────────────────────────────────────────
create table public.posts (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        references auth.users on delete cascade,
  voice_profile_id      uuid        references public.voice_profiles on delete set null,
  status                text        not null default 'draft'
                                    check (status in ('draft','generating','scored','reviewing','published')),
  product_data_json     jsonb,
  body_text             text,
  match_score           int,
  score_detail_json     jsonb,
  review_checklist_json jsonb,
  naver_post_url        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.posts enable row level security;

create policy "posts: owner select"
  on public.posts for select
  using (user_id = auth.uid());

create policy "posts: owner insert"
  on public.posts for insert
  with check (user_id = auth.uid());

create policy "posts: owner update"
  on public.posts for update
  using (user_id = auth.uid());

create policy "posts: owner delete"
  on public.posts for delete
  using (user_id = auth.uid());

-- ── post_images ──────────────────────────────────────────────
create table public.post_images (
  id                     uuid        primary key default gen_random_uuid(),
  post_id                uuid        not null references public.posts on delete cascade,
  source_type            text        not null check (source_type in ('official','stock','user_uploaded')),
  storage_path           text        not null,
  public_url             text        not null,
  vision_interpretation  text,
  placement_index        int,
  generated_paragraph    text,
  created_at             timestamptz not null default now()
);

alter table public.post_images enable row level security;

create policy "post_images: owner select"
  on public.post_images for select
  using (
    exists (
      select 1 from public.posts
      where posts.id = post_images.post_id
        and posts.user_id = auth.uid()
    )
  );

create policy "post_images: owner insert"
  on public.post_images for insert
  with check (
    exists (
      select 1 from public.posts
      where posts.id = post_images.post_id
        and posts.user_id = auth.uid()
    )
  );

create policy "post_images: owner update"
  on public.post_images for update
  using (
    exists (
      select 1 from public.posts
      where posts.id = post_images.post_id
        and posts.user_id = auth.uid()
    )
  );

create policy "post_images: owner delete"
  on public.post_images for delete
  using (
    exists (
      select 1 from public.posts
      where posts.id = post_images.post_id
        and posts.user_id = auth.uid()
    )
  );

-- ── updated_at 자동 갱신 트리거 ──────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger voice_profiles_updated_at
  before update on public.voice_profiles
  for each row execute function public.set_updated_at();

create trigger posts_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- ── Storage 버킷 'post-images' (public read) ─────────────────
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

-- 버킷 public read 정책
create policy "post-images: public read"
  on storage.objects for select
  using (bucket_id = 'post-images');

-- 버킷 owner write 정책
create policy "post-images: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'post-images'
    and auth.uid() is not null
  );

create policy "post-images: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'post-images'
    and owner = auth.uid()
  );
