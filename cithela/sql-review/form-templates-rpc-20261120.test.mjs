import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('./form-templates-rpc-20261120.sql', import.meta.url), 'utf8');

test('plantillas solo en esquema privado y con RLS', () => {
  assert.match(sql, /create table if not exists cithela_private\.cithela_form_templates/i);
  assert.match(sql, /alter table cithela_private\.cithela_form_templates enable row level security/i);
  assert.match(sql, /revoke all on table cithela_private\.cithela_form_templates\s+from public,anon,authenticated/i);
  assert.doesNotMatch(sql, /create table (?:if not exists )?public\.cithela_form_templates/i);
});

test('plantillas vinculadas al tenant y al servicio, evitando referencias cruzadas', () => {
  assert.match(sql, /foreign key\(tenant_id,service_id\)\s+references public\.cithela_services\(tenant_id,id\)/i);
  assert.match(sql, /where m\.tenant_id=p_tenant_id and m\.user_id=v_actor/i);
  assert.match(sql, /and m\.role in \('owner','admin'\)/i);
  assert.match(sql, /and t\.status='active'/i);
  assert.match(sql, /and f\.tenant_id=p_tenant_id/i);
  assert.match(sql, /where tenant_id=p_tenant_id and service_id=p_service_id/i);
});

test('versionado, borradores, límite de campos y publicación única', () => {
  assert.match(sql, /status text not null default 'draft'/i);
  assert.match(sql, /version bigint not null default 1 check\(version>=1\)/i);
  assert.match(sql, /jsonb_array_length\(p_fields\)>15/i);
  assert.match(sql, /where status='published'/i);
  assert.match(sql, /if v_row\.version<>p_expected_version then/i);
  assert.match(sql, /if v_row\.status<>'draft'/i);
  assert.match(sql, /code','service_inactive'/i);
  assert.match(sql, /p_action is null or p_action not in/i);
});

test('funciones autenticadas, revocación explícita de acceso anónimo', () => {
  for (const fn of ['cithela_form_template_save', 'cithela_form_template_set_status', 'cithela_form_templates_list']) {
    assert.match(sql, new RegExp('create or replace function public\\.' + fn + '\\('));
    assert.match(sql, new RegExp('revoke all on function public\\.' + fn + '\\('));
    assert.match(sql, new RegExp('grant execute on function public\\.' + fn + '\\('));
  }
  assert.match(sql, /security definer set search_path to ''/i);
  assert.match(sql, /if v_actor is null/i);
  assert.doesNotMatch(sql, /grant execute[^;]+\bto anon\b/i);
});

test('sin respuestas de personas, datos clínicos o cobros', () => {
  assert.doesNotMatch(sql, /create table[^;]+\bsubmissions\b/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from)\s+public\.cithela_(?:people|appointments|patient_links)\b/i);
  assert.doesNotMatch(sql, /(?:mercadopago|paypal|stripe|receta|historia_clinica)/i);
  assert.match(sql, /'field_count',jsonb_array_length\(v_row\.fields\)/i);
  assert.doesNotMatch(sql, /'payload',\s*p_fields/i);
});
