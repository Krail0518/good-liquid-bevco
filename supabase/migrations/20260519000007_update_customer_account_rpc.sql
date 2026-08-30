-- ============================================================
-- RPC: portal customer updates their own client account fields
-- ============================================================
-- Granting raw UPDATE on the `clients` table to portal customers would
-- let them edit any column — including admin-controlled fields like
-- `name`, `status`, `billed`, `payment_method`, `tax_exempt`, etc.
-- Postgres RLS gates rows but not columns, so to lock down columns
-- without affecting staff this RPC runs SECURITY DEFINER and updates
-- only the customer-editable subset, on whichever client_id is bound
-- to the calling auth user via customer_users.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create or replace function public.update_customer_account(
  p_contact_name      text    default null,
  p_contact_type      text    default null,
  p_email             text    default null,
  p_phone             text    default null,
  p_additional_emails jsonb   default null,
  p_street            text    default null,
  p_city              text    default null,
  p_state             text    default null,
  p_zip               text    default null,
  p_shipping_same     boolean default null,
  p_shipping_street   text    default null,
  p_shipping_city     text    default null,
  p_shipping_state    text    default null,
  p_shipping_zip      text    default null,
  p_lift_gate         boolean default null,
  p_dock_hours        text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_client_id uuid;
begin
  select client_id into v_client_id
    from public.customer_users
   where auth_user_id = auth.uid() and active = true
   limit 1;
  if v_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_customer');
  end if;

  update public.clients set
    contact_name      = coalesce(p_contact_name,      contact_name),
    contact_type      = coalesce(p_contact_type,      contact_type),
    email             = coalesce(p_email,             email),
    phone             = coalesce(p_phone,             phone),
    additional_emails = coalesce(p_additional_emails, additional_emails),
    street            = coalesce(p_street,            street),
    city              = coalesce(p_city,              city),
    state             = coalesce(p_state,             state),
    zip               = coalesce(p_zip,               zip),
    shipping_same     = coalesce(p_shipping_same,     shipping_same),
    shipping_street   = coalesce(p_shipping_street,   shipping_street),
    shipping_city     = coalesce(p_shipping_city,     shipping_city),
    shipping_state    = coalesce(p_shipping_state,    shipping_state),
    shipping_zip      = coalesce(p_shipping_zip,      shipping_zip),
    lift_gate         = coalesce(p_lift_gate,         lift_gate),
    dock_hours        = coalesce(p_dock_hours,        dock_hours)
  where id = v_client_id;

  return jsonb_build_object('ok', true, 'client_id', v_client_id);
end
$$;

grant execute on function public.update_customer_account(
  text, text, text, text, jsonb, text, text, text, text,
  boolean, text, text, text, text, boolean, text
) to authenticated;

notify pgrst, 'reload schema';
