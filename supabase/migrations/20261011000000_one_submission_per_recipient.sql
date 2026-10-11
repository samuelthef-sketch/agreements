-- Each recipient can submit the agreement only once.
-- check_recipient returns 'already_submitted' for a recipient who has finished,
-- and create_submission / finalize_submission refuse a second submission.

create unique index submissions_one_completed_per_recipient
  on public.submissions(recipient_id) where status = 'completed';

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
    if exists (select 1 from public.submissions s
               where s.recipient_id = v_ids[1] and s.status = 'completed') then
      return query select v_ids[1], 'already_submitted'::text;
    else
      return query select v_ids[1], 'ok'::text;
    end if;
  elsif coalesce(array_length(v_ids,1),0) > 1 then
    return query select null::bigint, 'ambiguous'::text;
  else
    return query select null::bigint, 'not_found'::text;
  end if;
end $$;

create or replace function private.create_submission(p_name text, p_agreed boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_match record;
  v_path text;
begin
  select * into v_match from private.match_recipient(p_name);
  if v_match.status = 'already_submitted' then
    raise exception 'already_submitted';
  elsif v_match.status <> 'ok' then
    raise exception 'Name not on the list (%)', v_match.status;
  end if;
  v_path := to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD') || '/' || gen_random_uuid()::text || '.png';
  insert into public.submissions(recipient_id, typed_name, agreed, image_path)
  values (v_match.recipient_id, btrim(p_name), coalesce(p_agreed, false), v_path);
  return v_path;
end $$;

-- If two submissions race, only the first one to finish counts.
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
exception when unique_violation then
  return false;
end $$;
