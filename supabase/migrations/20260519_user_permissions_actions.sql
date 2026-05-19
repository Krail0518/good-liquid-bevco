-- ============================================================
-- Action-level permission components + role presets
-- ============================================================
-- Builds on 20260519_user_permissions.sql. Adds gateable
-- destructive/financial actions (delete invoice, mark paid,
-- export everything, etc.) so the admin can hand a non-admin
-- "Sales" or "Viewer" account that can see invoices but NOT
-- delete them, or see dashboards but NOT export the backup.
--
-- Idempotent. Safe to re-run.
-- ============================================================

insert into public.permission_components (id, label, category, description, default_on, sort_order) values
  ('action.invoice.delete',         'Delete invoices',            'action', 'Permanently delete an invoice (cannot be undone).',                                false, 300),
  ('action.invoice.mark_paid',      'Manually mark invoice paid', 'action', 'Click "✓ Mark paid" without going through Stripe. Bypasses webhook auto-update.',  true,  301),
  ('action.invoice.send',           'Email invoice to customer',  'action', 'Send the invoice via Mailgun. Triggers an outbound email + scheduled follow-ups.', true,  302),
  ('action.client.delete',          'Delete a client',            'action', 'Removes a client and cascades to their invoices, production runs, etc.',           false, 303),
  ('action.deal.delete',            'Delete a pipeline deal',     'action', 'Remove a deal from the pipeline kanban.',                                          false, 304),
  ('action.production_run.delete',  'Delete a production run',    'action', 'Removes a run from the production board.',                                         false, 305),
  ('action.export.bulk',            'Admin backup export',        'action', 'Download a ZIP of every table — sensitive data.',                                  false, 306),
  ('action.export.csv',             'Export invoices CSV',        'action', 'Bulk export the invoices table to spreadsheet.',                                   true,  307),
  ('action.customer.invite',        'Invite customer portal',     'action', 'Create or re-invite a customer portal login.',                                     true,  308),
  ('action.customer.deactivate',    'Deactivate customer portal', 'action', 'Disable a customer\'s portal access.',                                             false, 309),
  ('action.referral.pay',           'Mark referral commission paid', 'action', 'Flip a referral commission to paid status.',                                    false, 310),
  ('action.user.invite',            'Invite staff user',          'action', 'Create a new staff login (CRM admin area).',                                       false, 311)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
