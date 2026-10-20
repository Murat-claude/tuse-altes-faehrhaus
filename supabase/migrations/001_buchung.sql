-- TUSÊ Altes Fährhaus – Buchungssystem (Supabase / Postgres)
-- Ersetzt die Reservierungs-Tabelle aus db/schema.sql. Gäste schreiben NICHT direkt in die Tabelle,
-- sondern über die Edge Function "reserve" (prüft Kapazität, sendet E-Mails).

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  restaurant_name text not null default 'TUSÊ Altes Fährhaus',
  restaurant_email text not null default '',
  restaurant_address text not null default 'Hamm',
  slot_minutes int not null default 30 check (slot_minutes in (15, 30, 60)),
  duration_minutes int not null default 120 check (duration_minutes between 30 and 360),
  capacity int not null default 40 check (capacity > 0),            -- Sitzplätze gleichzeitig
  max_party int not null default 12 check (max_party > 0),          -- größere Gruppen: Anfrage statt Buchung
  min_lead_minutes int not null default 120,                        -- frühestens in 2 Stunden
  max_days_ahead int not null default 90,
  auto_confirm boolean not null default true,                       -- true = sofort bestätigt
  -- Öffnungszeiten je Wochentag: Liste von [von, bis]; "bis" = letzte Reservierungszeit.
  -- PLATZHALTER: bitte vom Inhaber bestätigen lassen.
  opening jsonb not null default '{
    "mon": [["17:00","21:30"]], "tue": [["17:00","21:30"]], "wed": [["17:00","21:30"]],
    "thu": [["17:00","21:30"]], "fri": [["17:00","21:30"]], "sat": [["17:00","21:30"]],
    "sun": [["17:00","21:30"]]
  }'::jsonb
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Einzelne Tage sperren (Urlaub, Feiertag, private Feier)
create table if not exists public.closed_days (
  day date primary key,
  reason text
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  date date not null,
  time time not null,
  guests int not null check (guests between 1 and 50),
  name text not null,
  email text not null,
  phone text not null,
  note text,
  status text not null default 'neu' check (status in ('neu', 'bestaetigt', 'storniert')),
  token uuid not null default gen_random_uuid(),   -- Stornolink für den Gast
  ics_uid text
);
alter table public.reservations add column if not exists token uuid not null default gen_random_uuid();
alter table public.reservations add column if not exists ics_uid text;
create index if not exists reservations_date_idx on public.reservations (date, time);

alter table public.settings enable row level security;
alter table public.closed_days enable row level security;
alter table public.reservations enable row level security;

-- Alte direkte Gast-Policies entfernen (aus db/schema.sql)
drop policy if exists "anon insert reservations" on public.reservations;

-- Nur eingeloggte Mitarbeiter (Admin-Seite) dürfen lesen und ändern.
drop policy if exists "staff all reservations" on public.reservations;
create policy "staff all reservations" on public.reservations for all to authenticated using (true) with check (true);
drop policy if exists "staff all settings" on public.settings;
create policy "staff all settings" on public.settings for all to authenticated using (true) with check (true);
drop policy if exists "staff all closed_days" on public.closed_days;
create policy "staff all closed_days" on public.closed_days for all to authenticated using (true) with check (true);

-- Belegung zu einem Zeitpunkt: Gäste aller Reservierungen, deren Zeitfenster diesen Moment umfasst.
create or replace function public.slot_load(p_ts timestamp)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.guests), 0)::int
  from reservations r, settings s
  where s.id = 1
    and r.date between p_ts::date - 1 and p_ts::date
    and r.status <> 'storniert'
    and (r.date + r.time) <= p_ts
    and p_ts < (r.date + r.time) + make_interval(mins => s.duration_minutes);
$$;

-- Spitzenbelegung über die gesamte Dauer einer neuen Reservierung (alle Slot-Beginne im Fenster).
create or replace function public.peak_load(p_ts timestamp)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(public.slot_load(x)), 0)::int
  from settings s,
       generate_series(p_ts, p_ts + make_interval(mins => s.duration_minutes - 1), make_interval(mins => s.slot_minutes)) as x
  where s.id = 1;
$$;

-- Freie Zeitfenster für einen Tag (öffentlich abrufbar, gibt nur Zahlen zurück).
create or replace function public.get_slots(p_date date, p_guests int default 2)
returns table (slot text, free int, available boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  s settings%rowtype;
  wkey text;
  w jsonb;
  t timestamp;
  now_local timestamp := now() at time zone 'Europe/Berlin';
begin
  select * into s from settings where id = 1;
  if p_date is null or p_date < now_local::date or p_date > now_local::date + s.max_days_ahead then return; end if;
  if exists (select 1 from closed_days c where c.day = p_date) then return; end if;
  wkey := (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from p_date)::int];
  for w in select * from jsonb_array_elements(coalesce(s.opening -> wkey, '[]'::jsonb)) loop
    for t in select generate_series(p_date + (w ->> 0)::time, p_date + (w ->> 1)::time, make_interval(mins => s.slot_minutes)) loop
      if t < now_local + make_interval(mins => s.min_lead_minutes) then continue; end if;
      slot := to_char(t, 'HH24:MI');
      free := greatest(s.capacity - public.peak_load(t), 0);
      available := free >= p_guests and p_guests <= s.max_party and p_guests >= 1;
      return next;
    end loop;
  end loop;
end;
$$;

-- Atomar buchen (nur für die Edge Function mit service_role).
create or replace function public.book_table(
  p_date date, p_time text, p_guests int, p_name text, p_email text, p_phone text, p_note text default null
) returns reservations
language plpgsql security definer set search_path = public as $$
declare
  s settings%rowtype;
  r reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('book_table:' || p_date::text));
  select * into s from settings where id = 1;
  if not exists (select 1 from public.get_slots(p_date, p_guests) g where g.slot = p_time and g.available) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  insert into reservations (date, time, guests, name, email, phone, note, status)
  values (p_date, p_time::time, p_guests, trim(p_name), lower(trim(p_email)), trim(p_phone), nullif(trim(p_note), ''),
          case when s.auto_confirm then 'bestaetigt' else 'neu' end)
  returning * into r;
  update reservations set ics_uid = r.id::text || '@tuse-altes-faehrhaus' where id = r.id returning * into r;
  return r;
end;
$$;

revoke all on function public.book_table(date, text, int, text, text, text, text) from public, anon, authenticated;
grant execute on function public.book_table(date, text, int, text, text, text, text) to service_role;
revoke all on function public.slot_load(timestamp), public.peak_load(timestamp) from public, anon, authenticated;
grant execute on function public.slot_load(timestamp), public.peak_load(timestamp) to service_role;
grant execute on function public.get_slots(date, int) to anon, authenticated, service_role;
