-- Tracked keyword limits raised to 30 / 75 / 150 (Starter / Shop / Power),
-- about 3 keywords for 10 / 25 / 50 listings. Founder-approved 2026-09-26.
-- Apply BEFORE deploying the code that writes the new values; the old check
-- would reject 75 and 150. Safe to run more than once: rows are remapped only
-- while the OLD check (0, 10, 30, 100) is still in place.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'listing_monitors_keyword_limit_check'
      and pg_get_constraintdef(oid) like '%100]%'
  ) then
    alter table public.listing_monitors drop constraint listing_monitors_keyword_limit_check;
    -- 10 -> 30, 30 -> 75, 100 -> 150. Raising only, so the trigger allows it.
    update public.listing_monitors set keyword_limit = case keyword_limit
      when 10 then 30 when 30 then 75 when 100 then 150 else keyword_limit end
    where keyword_limit in (10, 30, 100);
  end if;
end $$;

alter table public.listing_monitors
  alter column keyword_limit set default 30,
  drop constraint if exists listing_monitors_keyword_limit_check;
alter table public.listing_monitors
  add constraint listing_monitors_keyword_limit_check
    check (keyword_limit in (0, 30, 75, 150));
