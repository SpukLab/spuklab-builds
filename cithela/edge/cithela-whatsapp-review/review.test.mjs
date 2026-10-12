import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const TENANT = "50b3e3eb-77a5-413d-af3b-9aa5b56e833e";
const OTHER = "11111111-2222-4333-8444-555555555555";
const EVENT = "2903949d-f170-48c4-9273-2abad48a715d";
const CONN = "542ad49e-df0a-4833-bc95-773c1a5de364";

async function harness({ role = "owner", text = "Quiero reservar un turno", resourceCount = 1,
  outgoingStatus = null } = {}) {
  let handler;
  const calls = [];
  const deno = {
    env: { get: (key) => ({ SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-secret" })[key] || null },
    serve: (fn) => { handler = fn; },
  };
  const db = {
    auth: { getUser: async token => token === "valid"
      ? { data: { user: { id: "user-1" } }, error: null }
      : { data: {}, error: { message: "invalid token" } } },
    from(table) {
      const eq = {};
      return {
        select() { return this; }, eq(k, v) { eq[k] = v; return this; },
        order() { return this; },
        async maybeSingle() {
          calls.push({ table, eq: { ...eq } });
          if (table === "cithela_tenant_memberships")
            return { data: eq.tenant_id === TENANT && eq.user_id === "user-1" ? { role } : null, error: null };
          if (table === "cithela_tenants")
            return { data: eq.id === TENANT ? { status: "active", timezone: "America/Argentina/Buenos_Aires" } : null, error: null };
          if (table === "cithela_channel_inbox")
            return { data: eq.id === EVENT && eq.tenant_id === TENANT
              ? { id: EVENT, connection_id: CONN, external_event_id: "wamid.test", message_type: "text", text_body: text } : null, error: null };
          if (table === "cithela_channel_connections")
            return { data: eq.id === CONN && eq.tenant_id === TENANT && eq.status === "active"
              ? { external_account_id: "test_phone_id" } : null, error: null };
          throw Error("unexpected single " + table);
        },
        async limit() {
          calls.push({ table, eq: { ...eq } });
          if (table !== "cithela_channel_inbox") throw Error("unexpected list");
          return { data: [{ id: EVENT, external_event_id: "wamid.test", sender_name: "Test",
            message_type: "text", text_body: text, status: "new", received_at: "2026-10-11T16:11:52Z" }], error: null };
        },
        async in(field, ids) {
          calls.push({ table, eq: { ...eq }, field, ids });
          if (table !== "cithela_channel_outbox") throw Error("unexpected outbox lookup");
          return { data: outgoingStatus
            ? [{ inbox_event_id: EVENT, status: outgoingStatus, reply_text: "Estos son los horarios...",
              attempted_at: "2026-10-11T16:14:52Z",
              sent_at: outgoingStatus === "sent" ? "2026-10-11T16:15:10Z" : null }]
            : [], error: null };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      assert.equal(name, "cithela_channel_command");
      assert.equal(args.p_external_account_id, "test_phone_id");
      if (args.p_command === "catalog.services")
        return { data: { ok: true, items: [{ name: "Corte", id: "svc" }, { name: "Consulta", id: "con" }], timezone: "America/Argentina/Buenos_Aires" }, error: null };
      if (args.p_command === "catalog.resources")
        return { data: { ok: true, items: Array.from({ length: resourceCount }, (_, i) => ({ id: "res" + i })) }, error: null };
      if (args.p_command === "availability.query")
        return { data: { ok: true, date: args.p_payload.date, slots: ["09:00", "09:15", "10:00", "11:00"] }, error: null };
      throw Error("mutation or unsupported command");
    },
  };
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const js = src.replace(/^import\s+.*?;\s*$/m, "");
  new Function("Deno", "createClient", js)(deno, () => db);
  return {
    calls,
    async request(action, tenant_id = TENANT, event_id = EVENT, token = "valid", origin = "https://spuklab.github.io") {
      const request = new Request("https://example.invalid", { method: "POST",
        headers: { "content-type": "application/json", origin, authorization: "Bearer " + token },
        body: JSON.stringify({ action, tenant_id, event_id }) });
      const response = await handler(request);
      return { status: response.status, body: await response.json() };
    },
  };
}

test("denies invalid access token", async () => {
  const h = await harness();
  const result = await h.request("list", TENANT, EVENT, "bad");
  assert.equal(result.status, 401);
  assert.equal(h.calls.length, 0);
});
test("denies another tenant, without inbox read", async () => {
  const h = await harness();
  const result = await h.request("list", OTHER);
  assert.equal(result.status, 403);
  assert.equal(h.calls.filter(x => x.table === "cithela_channel_inbox").length, 0);
});
test("denies non-admin memberships", async () => {
  const h = await harness({ role: "operator" });
  const result = await h.request("prepare");
  assert.equal(result.status, 403);
});
test("rejects unexpected browser origin", async () => {
  const h = await harness();
  const result = await h.request("list", TENANT, EVENT, "valid", "https://evil.invalid");
  assert.equal(result.status, 403);
});
test("lists only tenant-scoped messages", async () => {
  const h = await harness();
  const result = await h.request("list");
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 1);
  const read = h.calls.find(x => x.table === "cithela_channel_inbox");
  assert.equal(read.eq.tenant_id, TENANT);
  assert.equal(read.eq.channel, "whatsapp");
  const outbox = h.calls.find(x => x.table === "cithela_channel_outbox");
  assert.equal(outbox.eq.tenant_id, TENANT);
  assert.deepEqual(outbox.ids, [EVENT]);
  assert.equal(result.body.items[0].outbound, null);
});
test("asks for service if missing; never writes", async () => {
  const h = await harness();
  const result = await h.request("prepare");
  assert.equal(result.body.code, "needs_service");
  assert.equal(h.calls.filter(x => x.rpc === "cithela_channel_command").length, 1);
});
test("suggests three provider slots, without booking", async () => {
  const h = await harness({ text: "Necesito turno para Corte" });
  const result = await h.request("prepare");
  assert.equal(result.status, 200);
  assert.equal(result.body.code, "slots_preview");
  assert.equal(result.body.slots.length, 3);
  assert.ok(h.calls.filter(x => x.rpc).every(x =>
    ["catalog.services", "catalog.resources", "availability.query"].includes(x.args.p_command)));
});
test("requires resource choice for multiple professionals", async () => {
  const h = await harness({ text: "Corte", resourceCount: 2 });
  const result = await h.request("prepare");
  assert.equal(result.body.code, "needs_resource");
});

test("tintura maps uniquely to Coloración without guessing combined services", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const js = src.replace(/^import\s+.*?;\s*$/m, "");
  const fn = new Function("Deno", "createClient", js + "\nreturn matchService;");
  const match = fn({ env: { get: () => null }, serve: () => {} }, () => ({}));
  const services = [{ id: "color", name: "Coloración" }, { id: "cut", name: "Corte" }];
  assert.equal(match("Quiero un turno para tintura", services)?.id, "color");
  assert.equal(match("Quiero un turno para corte", services)?.id, "cut");
  assert.equal(match("Quiero corte y tintura", services), null);
});


test("understands weekday with an explicit afternoon minimum", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const js = src.replace(/^import\s+.*?;\s*$/m, "");
  const f = new Function("Deno", "createClient", js + "\nreturn {parseRequestedPreferences,chooseSpreadSlots};");
  const helpers = f({env:{get:()=>null},serve(){}},()=>({}));
  const days = ["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"];
  assert.deepEqual(helpers.parseRequestedPreferences("Tintura el jueves despues de las 16",days), {
    date:"2026-10-15", lower:960, upper:1440, exact:null, hasPreference:true
  });
  assert.deepEqual(helpers.parseRequestedPreferences("Turno mañana por la tarde",days), {
    date:"2026-10-13", lower:780, upper:1140, exact:null, hasPreference:true
  });
  assert.equal(helpers.parseRequestedPreferences("Turno por la mañana",days).date,null);
  assert.equal(helpers.parseRequestedPreferences("El viernes a las 17:30",days).exact,1050);
  assert.equal(helpers.parseRequestedPreferences("El lunes 15/10",days).clarification.includes("dos fechas"),true);
  assert.equal(helpers.parseRequestedPreferences("jueves y viernes",days).clarification.includes("día concreto"),true);
  assert.equal(helpers.parseRequestedPreferences("lunes despues de las 19 por la mañana",days).clarification.includes("contradicen"),true);
});
test("offers real, separated suggestions instead of three adjacent times", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const js = src.replace(/^import\s+.*?;\s*$/m, "");
  const select = new Function("Deno", "createClient", js + "\nreturn chooseSpreadSlots;")
    ({env:{get:()=>null},serve(){}},()=>({}));
  assert.deepEqual(select([
    {date:"2026-10-12",slots:["09:00","09:15","14:00","14:15"]},
    {date:"2026-10-13",slots:["10:00","10:15"]}
  ]),[
    {date:"2026-10-12",hour:"09:00"},
    {date:"2026-10-12",hour:"14:00"},
    {date:"2026-10-13",hour:"10:00"}
  ]);
  assert.deepEqual(select([{date:"2026-10-12",slots:[]}]),[]);
});
test("clinical or commercial side questions demand human review", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const js = src.replace(/^import\s+.*?;\s*$/m, "");
  const review = new Function("Deno", "createClient", js + "\nreturn unsupportedConversationDetail;")
    ({env:{get:()=>null},serve(){}},()=>({}));
  assert.equal(review("Tintura a las 16, tengo alergia a productos"),true);
  assert.equal(review("Cuanto cuesta la coloracion?"),true);
  assert.equal(review("Quiero turno para tintura mañana"),false);
});

test("pairs accepted reply with the exact inbound message and never calls Meta", async () => {
  const h = await harness({ outgoingStatus: "sent" });
  const result = await h.request("list");
  assert.equal(result.status, 200);
  assert.equal(result.body.items[0].id, EVENT);
  assert.equal(result.body.items[0].outbound.status, "sent");
  assert.equal(result.body.items[0].outbound.reply_text, "Estos son los horarios...");
  assert.equal(h.calls.some(x => x.rpc), false);
});
test("failed or uncertain response is never advertised as pending", async () => {
  const h = await harness({ outgoingStatus: "unknown" });
  const result = await h.request("list");
  assert.equal(result.body.items[0].outbound.status, "unknown");
  assert.equal(result.body.items[0].outbound.sent_at, null);
});


// Frontend regression tests: no detached draft, no reused confirmation across events.
const TEST_ONE = "11111111-2222-4333-8444-555555555555";
const TEST_TWO = "66666666-7777-4888-8999-aaaaaaaaaaaa";
async function inboxUI(inbox = []) {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "Main script must exist");
  const begin = script.indexOf("let cloudWaBusy=false;");
  const end = script.indexOf("async function cloudPrepareWhatsappDraft(", begin);
  assert.ok(begin >= 0 && end > begin);
  const list = { textContent: "", innerHTML: "", querySelector: () => null };
  const counts = { textContent: "" };
  const nodes = { "cloud-wa-list": list, "cloud-wa-counts": counts };
  const $ = id => nodes[id] || null;
  const esc = value => String(value ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cloud = {
    state: () => ({ signedIn: true, tenant: { id: TEST_ONE }, membership: { role: "owner" } }),
    whatsappReview: async args => {
      assert.equal(args.action, "list");
      assert.equal(args.tenant_id, TEST_ONE);
      return { ok: true, items: inbox };
    },
  };
  const setup = new Function("escHtml", "$", "CithelaCloud", script.slice(begin, end) +
    "\nreturn {cloudWaMessageMarkup,cloudLoadWhatsappInbox};");
  return { ...setup(esc, $, cloud), list, counts };
}
const sample = (id, time, text, outbound = null) =>
  ({ id, received_at: time, text_body: text, sender_name: "Paciente", outbound });

test("UI sorts latest first and shows reply inside its original message", async () => {
  const old = sample(TEST_ONE, "2026-10-11T10:00:00Z", "Consulta anterior");
  const latest = sample(TEST_TWO, "2026-10-12T10:00:00Z", "Corte mañana", {
    status: "sent", reply_text: "Mañana a las 14",
  });
  const view = await inboxUI([old, latest]);
  await view.cloudLoadWhatsappInbox();
  assert.ok(view.list.innerHTML.indexOf(TEST_TWO) < view.list.innerHTML.indexOf(TEST_ONE));
  assert.match(view.counts.textContent, /Sin responder: 1/);
  assert.match(view.counts.textContent, /Meta aceptó: 1/);
  assert.match(view.list.innerHTML, new RegExp("cloud-wa-draft-box-" + TEST_ONE));
  assert.doesNotMatch(view.list.innerHTML, new RegExp("cloud-wa-draft-box-" + TEST_TWO));
  assert.match(view.list.innerHTML, /Mañana a las 14/);
});
test("UI blocks send actions on accepted and uncertain responses", async () => {
  const view = await inboxUI();
  for (const status of ["sent", "unknown", "sending"]) {
    const html = view.cloudWaMessageMarkup(sample(TEST_ONE, "2026-10-12T10:00:00Z",
      "Corte", {status, reply_text: "14:00"}));
    assert.match(html, /Respuesta vinculada a este mensaje/);
    assert.doesNotMatch(html, /Preparar respuesta a este mensaje/);
    assert.doesNotMatch(html, /Aprobar y enviar esta respuesta/);
  }
});
test("UI gives unique draft controls to each unanswered message", async () => {
  const view = await inboxUI();
  const first = view.cloudWaMessageMarkup(sample(TEST_ONE, "2026-10-11T10:00:00Z", "Corte"));
  const second = view.cloudWaMessageMarkup(sample(TEST_TWO, "2026-10-12T10:00:00Z", "Coloración"));
  assert.match(first, new RegExp("cloud-wa-draft-box-" + TEST_ONE));
  assert.doesNotMatch(first, new RegExp("cloud-wa-draft-box-" + TEST_TWO));
  assert.match(second, new RegExp("cloud-wa-draft-box-" + TEST_TWO));
  assert.doesNotMatch(second, new RegExp("cloud-wa-draft-box-" + TEST_ONE));
});
test("UI escapes patient messages and outgoing responses", async () => {
  const view = await inboxUI();
  const malicious = "<img src=x onerror=alert(1)>";
  const html = view.cloudWaMessageMarkup(sample(TEST_ONE, "2026-10-11T10:00:00Z",
    malicious, {status:"sent", reply_text:malicious}));
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});
