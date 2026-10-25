-- the client stack's own signature: header names in wire order with the per-request ones (cookie, referer, the
-- conditional pair) and the proxy's additions (via, x-forwarded-*, x-real-ip, cf-*) taken out. the same http
-- library sends the same thing on every request whatever user-agent string it wears, which is what makes it
-- worth a column of its own next to header_order_hash (every name, as sent). backfilled at boot for old rows.
ALTER TABLE events ADD COLUMN stack_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_events_stack ON events(stack_hash);
