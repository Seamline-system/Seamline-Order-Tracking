-- =====================================================================
-- Seamline — CLEAR ALL DATA, KEEP THE SET-UP
-- Deletes: customers (and their portal logins), leads, quotes, orders,
-- invoices, payments, expenses, products, stock, suppliers, purchase
-- orders, reorders, notifications and history. Numbering restarts at 00001.
-- Keeps: team logins and roles, company and bank details, EmailJS and
-- customer-message settings, categories and warehouses.
-- Cannot be undone.
--
-- 1. Optional: Seamline → Settings → Data → Export backup.
-- 2. Close Seamline's tabs.
-- 3. Supabase → SQL editor → New query → paste this file → Run.
-- 4. Open Seamline and sign in as usual.
-- =====================================================================
begin;
delete from public.records
  where collection not in ('settings', 'categories', 'users', 'warehouses', 'meta');
update public.records
  set data = jsonb_set(data, '{seq}', '{}'::jsonb)
  where collection = 'meta' and id = 'main';
truncate table public.public_docs, public.inbox;
delete from auth.users    -- customer portal logins only; team logins stay
  where lower(email) not in (select lower(email) from public.staff);
commit;
