#!/usr/bin/env bash
# Two refund events for one invoice at the same moment must not both read
# "nothing refunded yet" (GL-120, independent review R2).
#
# scripts/stripe-settlement-proof.sql proves the arithmetic in one session. This
# proves the part one session cannot: that a second session calling
# gl_apply_stripe_refund WAITS for the first to finish before it reads prior
# reversals. Session A takes the invoice lock through the RPC and holds it for
# HOLD seconds; session B starts shortly after and is timed. If B returns in
# well under HOLD, it did not wait, and the race the reviewer reproduced is open.
#
# Writes nothing: both sessions ROLL BACK, and both pass a cumulative refund of
# 0 cents, so the RPC reaches its "already reflected" branch without inserting.
# It does hold one real invoice's row lock for a few seconds, which only delays
# a payment on that invoice arriving in the same seconds.
#
#   bash scripts/stripe-refund-concurrency.sh
set -euo pipefail
HOLD=6
INV=$(supabase db query --linked "select invoice_number from public.invoices order by created_at limit 1" --output-format json 2>/dev/null \
  | grep -o '"invoice_number": *"[^"]*"' | head -1 | sed 's/.*: *"\(.*\)"/\1/')
[ -n "$INV" ] || { echo "UNVERIFIED: could not pick an invoice"; exit 2; }
esc=${INV//\'/\'\'}

supabase db query --linked "begin; select public.gl_apply_stripe_refund('evt_lockprobe_a','$esc','ch_lockprobe',100,0,null); select pg_sleep($HOLD); rollback;" >/dev/null 2>&1 &
A=$!
sleep 2
start=$(date +%s.%N)
out=$(supabase db query --linked "begin; select public.gl_apply_stripe_refund('evt_lockprobe_b','$esc','ch_lockprobe',100,0,null)::text as verdict; rollback;" --output-format json 2>&1 || true)
end=$(date +%s.%N)
wait $A || true

waited=$(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.1f", e-s}')
echo "invoice: $INV  hold: ${HOLD}s  session B took: ${waited}s"
echo "$out" | grep -o 'already_reflected' | head -1 || true
# B started ~2s into A's hold, so a real wait is ~HOLD-2 seconds on top of B's
# own round trip. Compare against a solo baseline so network time is not
# mistaken for waiting.
base_start=$(date +%s.%N)
supabase db query --linked "begin; select public.gl_apply_stripe_refund('evt_lockprobe_c','$esc','ch_lockprobe',100,0,null); rollback;" >/dev/null 2>&1 || true
base_end=$(date +%s.%N)
baseline=$(awk -v s="$base_start" -v e="$base_end" 'BEGIN{printf "%.1f", e-s}')
echo "solo baseline: ${baseline}s"
if awk -v w="$waited" -v b="$baseline" -v h="$HOLD" 'BEGIN{exit !(w - b >= h - 2 - 1)}'; then
  echo "PASS: the second refund waited for the first session's lock"
else
  echo "FAIL: the second refund did not wait; concurrent refunds can both read the same prior total"
  exit 1
fi
