import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

// Static guardrails on the EXACT code copied from the deployed webhook.
// Not a replacement for runtime signature tests or a Meta/Supabase E2E test.
test('POST verifies HMAC signature before any database ingestion', () => {
  const post = source.indexOf('if (req.method !== "POST")');
  const verify = source.indexOf('await verifyMetaSignature(');
  const reject = source.indexOf('if (!valid) return new Response("invalid signature", { status: 401 })');
  const admin = source.indexOf('const supabaseAdmin = createClient(');
  const ingest = source.indexOf('supabaseAdmin.rpc("cithela_channel_ingest"');
  assert.ok(post > 0 && verify > post && reject > verify);
  assert.ok(admin > reject && ingest > admin);
  assert.match(source, /req\.headers\.get\("x-hub-signature-256"\)/);
  assert.match(source, /\{ name: "HMAC", hash: "SHA-256" \}/);
  assert.match(source, /constantTimeEqual\(signature,/);
});

test('GET verification does not accept an arbitrary token', () => {
  assert.match(source, /constantTimeEqual\(token, verifyToken\)/);
  assert.match(source, /Deno\.env\.get\("META_WHATSAPP_VERIFY_TOKEN"\)/);
  assert.match(source, /return new Response\("forbidden", \{ status: 403 \}\)/);
});

test('server-side credentials and idempotent ingestion boundary remain', () => {
  assert.match(source, /Deno\.env\.get\("META_WHATSAPP_APP_SECRET"\)/);
  assert.match(source, /Deno\.env\.get\("SUPABASE_SECRET_KEYS"\)/);
  assert.match(source, /p_external_event_id: eventId/);
  assert.match(source, /event_duplicate/);
  assert.doesNotMatch(source, /\b(?:EAA[A-Za-z0-9_-]{20,}|sk_[A-Za-z0-9_-]{20,})\b/);
});
