-- Digital Agreement schema (applied to the "Agreement" Supabase project).
-- Public API: check_recipient, create_submission, finalize_submission (RPC).
-- The recipients list and submissions are not readable by anon/authenticated.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create table public.recipients (
  id bigint generated always as identity primary key,
  full_name text not null unique,
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  recipient_id bigint not null references public.recipients(id),
  typed_name text not null,
  agreed boolean not null,
  status text not null default 'pending' check (status in ('pending','completed')),
  image_path text not null unique,
  image_bucket text not null default 'agreement-submissions',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index submissions_recipient_id_idx on public.submissions(recipient_id);

alter table public.recipients enable row level security;
alter table public.submissions enable row level security;
revoke all on public.recipients, public.submissions from anon, authenticated;

insert into public.recipients(full_name) values
 ('Alexis Malawit'),('Raven San Jose'),('Gilbert Hipolito'),('Christopher Abellera'),
 ('Kyle Domingo'),('Miguel Antonio'),('Prince David Viterbo'),('Crystal Corpuz'),
 ('Cholo Ancheta'),('Ken Calosa'),('Mark Borinaga'),('Angie Morales'),('Icko Soriano'),
 ('Yvaine Gonzales'),('Johanna Belle'),('Cristine Calara'),('Jharel'),('Justine Burayag'),
 ('Ashley Abaracosso'),('Dhapniex Calosa'),('Parisse Marzan');

-- Every typed word must be a word of exactly one recipient's name.
-- "Alexis" -> Alexis Malawit; "Calosa" -> ambiguous (needs full name).
create or replace function private.match_recipient(p_name text)
returns table(recipient_id bigint, status text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tokens text[];
  v_ids bigint[];
begin
  v_tokens := array_remove(regexp_split_to_array(lower(btrim(coalesce(p_name,''))), '\s+'), '');
  if coalesce(array_length(v_tokens,1),0) = 0 or length(p_name) > 120 then
    return query select null::bigint, 'empty'::text; return;
  end if;
  select array_agg(r.id) into v_ids
  from public.recipients r
  where v_tokens <@ regexp_split_to_array(lower(r.full_name), '\s+');
  if coalesce(array_length(v_ids,1),0) = 1 then
    return query select v_ids[1], 'ok'::text;
  elsif coalesce(array_length(v_ids,1),0) > 1 then
    return query select null::bigint, 'ambiguous'::text;
  else
    return query select null::bigint, 'not_found'::text;
  end if;
end $$;

create or replace function private.can_upload(p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.image_path = p_path and s.status = 'pending'
      and s.created_at > now() - interval '15 minutes'
  );
$$;

create or replace function private.create_submission(p_name text, p_agreed boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_match record;
  v_path text;
begin
  select * into v_match from private.match_recipient(p_name);
  if v_match.status <> 'ok' then raise exception 'Name not on the list (%)', v_match.status; end if;
  v_path := to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD') || '/' || gen_random_uuid()::text || '.png';
  insert into public.submissions(recipient_id, typed_name, agreed, image_path)
  values (v_match.recipient_id, btrim(p_name), coalesce(p_agreed, false), v_path);
  return v_path;
end $$;

create or replace function private.finalize_submission(p_path text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.submissions s set status = 'completed', completed_at = now()
  where s.image_path = p_path and s.status = 'pending'
    and exists (select 1 from storage.objects o
                where o.bucket_id = 'agreement-submissions' and o.name = p_path);
  return found;
end $$;

revoke all on function private.match_recipient(text), private.can_upload(text),
  private.create_submission(text, boolean), private.finalize_submission(text) from public;
grant execute on function private.match_recipient(text), private.can_upload(text),
  private.create_submission(text, boolean), private.finalize_submission(text) to anon, authenticated;

-- Thin public wrappers (security invoker) exposed via /rest/v1/rpc/*
create function public.check_recipient(p_name text)
returns text language sql stable security invoker set search_path = ''
as $$ select m.status from private.match_recipient(p_name) m; $$;

create function public.create_submission(p_name text, p_agreed boolean)
returns text language sql security invoker set search_path = ''
as $$ select private.create_submission(p_name, p_agreed); $$;

create function public.finalize_submission(p_path text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.finalize_submission(p_path); $$;

revoke all on function public.check_recipient(text), public.create_submission(text, boolean),
  public.finalize_submission(text) from public;
grant execute on function public.check_recipient(text), public.create_submission(text, boolean),
  public.finalize_submission(text) to anon, authenticated;

-- Dashboard view (not exposed to anon)
create view public.submissions_overview with (security_invoker = true) as
select s.created_at, r.full_name, s.typed_name, s.agreed, s.status, s.image_bucket, s.image_path
from public.submissions s join public.recipients r on r.id = s.recipient_id
order by s.created_at desc;
revoke all on public.submissions_overview from anon, authenticated;

-- Private bucket for the final signed agreement images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agreement-submissions', 'agreement-submissions', false, 5242880, array['image/png'])
on conflict (id) do nothing;

create policy "anon upload signed agreement for pending submission"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'agreement-submissions' and private.can_upload(name));
