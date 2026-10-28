-- Run against a disposable Supabase database after applying the migration.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/raw_ingestion.sql
-- The transaction rolls back the test users and all inserted records.
begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

create function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'assertion failed: %', message; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select pg_temp.assert_true(
  (public.fudge_ingest_raw_reviews('[{"source":"google","source_review_id":"one","payload":{"text":"original"}}]'::jsonb)->0->>'inserted')::boolean,
  'first submission is inserted'
);
select pg_temp.assert_true(
  not (public.fudge_ingest_raw_reviews('[{"source":"google","source_review_id":"one","payload":{"text":"changed"}}]'::jsonb)->0->>'inserted')::boolean,
  'replay is not inserted'
);
select pg_temp.assert_true((select count(*) = 1 and min(payload->>'text') = 'original' from public.fudge_raw_reviews), 'original remains unchanged');

do $$
begin
  begin
    perform public.fudge_ingest_raw_reviews('[{"source":"google","source_review_id":"two","payload":{}},{"source":"google","payload":{}}]'::jsonb);
    raise exception 'invalid batch unexpectedly succeeded';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
select pg_temp.assert_true((select count(*) = 1 from public.fudge_raw_reviews), 'invalid batch is atomic');

do $$
begin
  begin
    insert into public.fudge_raw_reviews (owner_id, source, source_review_id, payload)
      values ('11111111-1111-4111-8111-111111111111', 'google', 'direct', '{}');
    raise exception 'direct write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select pg_temp.assert_true((select count(*) = 0 from public.fudge_raw_reviews), 'RLS isolates users');
select pg_temp.assert_true(
  (public.fudge_ingest_raw_reviews('[{"source":"google","source_review_id":"one","payload":{}}]'::jsonb)->0->>'inserted')::boolean,
  'same source identity is scoped to its owner'
);

reset role;
set local role anon;
do $$
begin
  begin
    perform public.fudge_ingest_raw_reviews('[{"source":"google","source_review_id":"anonymous","payload":{}}]'::jsonb);
    raise exception 'anonymous ingestion unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
