-- =====================================================================
-- Seamline — RESET EVERYTHING (like a brand-new install)
-- Deletes ALL business data, company settings, EmailJS settings,
-- team logins and customer logins. Cannot be undone.
--
-- 1. Optional: Seamline → Settings → Data → Export backup.
-- 2. Sign out of Seamline and close its tabs.
-- 3. Supabase → SQL editor → New query → paste this file → Run.
-- 4. Open Seamline: you'll see "Create your workspace". The first person
--    to sign up becomes the admin.
-- =====================================================================
begin;
truncate table public.records, public.public_docs, public.inbox;
delete from public.staff;
delete from auth.users;   -- every login (team and customers)
commit;
