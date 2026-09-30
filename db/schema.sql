-- TUSÊ Altes Fährhaus – Supabase-Schema (Version 1)
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  date date not null,
  time time not null,
  guests int not null check (guests between 1 and 20),
  name text not null,
  email text not null,
  phone text not null,
  note text,
  status text not null default 'neu' check (status in ('neu','bestaetigt','storniert'))
);
create table if not exists event_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,
  date date,
  guests int check (guests between 1 and 1000),
  name text not null,
  email text not null,
  phone text,
  message text,
  status text not null default 'neu' check (status in ('neu','beantwortet','gebucht','abgesagt'))
);
alter table reservations enable row level security;
alter table event_inquiries enable row level security;
-- Besucher dürfen nur anlegen, nicht lesen.
create policy "anon insert reservations" on reservations for insert to anon with check (status = 'neu');
create policy "anon insert inquiries" on event_inquiries for insert to anon with check (status = 'neu');
-- Nur eingeloggte Mitarbeiter (Admin-Panel) dürfen lesen und ändern.
create policy "staff all reservations" on reservations for all to authenticated using (true) with check (true);
create policy "staff all inquiries" on event_inquiries for all to authenticated using (true) with check (true);
