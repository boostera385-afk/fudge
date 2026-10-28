-- Phase 2 foundation: per-user, append-only raw review ingestion.
-- Existing Fudge/Sheets code does not call this endpoint yet.

create table public.fudge_raw_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (char_length(source) between 1 and 64),
  source_review_id text not null check (char_length(source_review_id) between 1 and 512),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  unique (owner_id, source, source_review_id)
);

alter table public.fudge_raw_reviews enable row level security;

-- A user can inspect only their own records. No direct client mutations: the
-- RPC below validates input and never overwrites original source material.
create policy "read own raw reviews" on public.fudge_raw_reviews
  for select to authenticated using (owner_id = auth.uid());

revoke all on public.fudge_raw_reviews from public, anon, authenticated;
grant select on public.fudge_raw_reviews to authenticated;

-- Called with a Supabase authenticated user JWT, not a service-role key.
-- Each review has a stable source + source_review_id and an original payload.
-- Replays return the existing ID and leave the first payload untouched. A
-- whole invalid batch fails atomically; callers keep it locally for repair.
create function public.fudge_ingest_raw_reviews(p_reviews jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_review jsonb;
  v_source text;
  v_source_id text;
  v_id uuid;
  v_inserted boolean;
  v_results jsonb := '[]'::jsonb;
begin
  if v_owner is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_reviews is null or jsonb_typeof(p_reviews) <> 'array' then
    raise exception 'reviews must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_reviews) < 1 or jsonb_array_length(p_reviews) > 100 then
    raise exception 'batch must contain 1 to 100 reviews' using errcode = '22023';
  end if;
  if pg_column_size(p_reviews) > 1048576 then
    raise exception 'batch exceeds 1 MiB' using errcode = '22023';
  end if;

  for v_review in select value from jsonb_array_elements(p_reviews) loop
    if jsonb_typeof(v_review) <> 'object'
       or jsonb_typeof(v_review->'source') is distinct from 'string'
       or jsonb_typeof(v_review->'source_review_id') is distinct from 'string'
       or jsonb_typeof(v_review->'payload') is distinct from 'object' then
      raise exception 'each review requires source, source_review_id, and object payload' using errcode = '22023';
    end if;
    v_source := btrim(v_review->>'source');
    v_source_id := btrim(v_review->>'source_review_id');
    if char_length(v_source) not between 1 and 64 or char_length(v_source_id) not between 1 and 512 then
      raise exception 'invalid source or source_review_id length' using errcode = '22023';
    end if;

    v_id := null;
    insert into public.fudge_raw_reviews (owner_id, source, source_review_id, payload)
      values (v_owner, v_source, v_source_id, v_review->'payload')
      on conflict (owner_id, source, source_review_id) do nothing
      returning id into v_id;
    v_inserted := v_id is not null;
    if not v_inserted then
      select id into strict v_id from public.fudge_raw_reviews
        where owner_id = v_owner and source = v_source and source_review_id = v_source_id;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'source', v_source, 'source_review_id', v_source_id,
      'id', v_id, 'inserted', v_inserted
    ));
  end loop;
  return v_results;
end;
$$;

revoke all on function public.fudge_ingest_raw_reviews(jsonb) from public, anon;
grant execute on function public.fudge_ingest_raw_reviews(jsonb) to authenticated;
