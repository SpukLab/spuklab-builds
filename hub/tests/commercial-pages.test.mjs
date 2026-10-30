import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pages = [
  'hub/index.html',
  'hub/productos/cithela/index.html',
  'hub/productos/dahzea/index.html',
];
const read = (path) => readFileSync(join(root, path), 'utf8');
const links = (text) => [...text.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]);
const ids = (text) => new Set([...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

test('Hub: cards de CITHELA y DAHZEA conducen a páginas comerciales separadas', () => {
  const html = read(pages[0]);
  assert.match(html, /class="product cithela"[\s\S]*?href="productos\/cithela\/"/);
  assert.match(html, /class="product dahzea"[\s\S]*?href="productos\/dahzea\/"/);
  assert.match(html, /SURKARA/);
  assert.match(html, /Operaciones y logística agro/);
  assert.match(html, /campo y transporte/i);
  assert.match(html, /class="showcase-panel showcase-cithela"/);
  assert.match(html, /class="showcase-panel showcase-dahzea"/);
  assert.match(html, /class="showcase-panel showcase-surkara"/);
  assert.match(html, /id="enfoque"/);
  assert.doesNotMatch(html, /orbit-frame|SPUKLAB HUB|multicliente|diagrama|id="plataforma"/i);

  assert.doesNotMatch(html, /href="https:\/\/dahzea\.dentrix-8m\.chatgpt\.site\/"/);
});

for (const page of pages) {
  test(page + ': enlaces locales y anclas resuelven', () => {
    const html = read(page);
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<title>.+<\/title>/);
    assert.match(html, /<meta name="viewport"/);
    const availableIds = ids(html);
    assert.equal(availableIds.size, [...html.matchAll(/\bid="([^"]+)"/g)].length, 'IDs duplicados');
    for (const href of links(html)) {
      if (/^(?:https?:|mailto:|tel:|data:)/i.test(href)) continue;
      if (href.startsWith('#')) {
        assert.ok(availableIds.has(href.slice(1)), 'Ancla ausente: ' + page + ' -> ' + href);
        continue;
      }
      assert.ok(!isAbsolute(href), 'Ruta absoluta inesperada: ' + href);
      const clean = href.split('#')[0].split('?')[0];
      const target = resolve(root, dirname(page), clean);
      assert.ok(target.startsWith(root), 'Ruta sale del repositorio: ' + href);
      const targetFile = clean.endsWith('/') ? join(target, 'index.html') : target;
      assert.ok(existsSync(targetFile), 'Enlace roto: ' + page + ' -> ' + href + ' (' + targetFile + ')');
    }
  });
  test(page + ': no contiene credenciales, formularios ni redes operativas', () => {
    const html = read(page);
    assert.doesNotMatch(html, /<form\b/i);
    assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|EventSource\s*\(|new WebSocket\s*\(/);
    assert.doesNotMatch(html, /\bservice_role\b|MERCADOLIBRE_CLIENT_SECRET|OPENAI_API_KEY|META_ACCESS_TOKEN/i);
  });
}

test('CITHELA comercial: separado del acceso profesional y con límites de piloto', () => {
  const html = read(pages[1]);
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/cithela\/"/);
  assert.match(html, /Incorporación al piloto mediante invitación/i);
  assert.match(html, /piloto supervisado/i);
  assert.doesNotMatch(html, /<script\b/i);
});

test('DAHZEA comercial: distingue fuente ML, trabajo de empaque y ejemplos ficticios', () => {
  const html = read(pages[2]);
  assert.match(html, /Lo que dice la plataforma/);
  assert.match(html, /Lo que hace tu equipo/);
  assert.match(html, /Los ejemplos son ficticios/i);
  assert.match(html, /paridad absoluta/i);
  assert.match(html, /Piloto supervisado en validación/i);
  assert.doesNotMatch(html, /15 días/i);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
  for (const panel of ['ventas','packing','postventa']) {
    assert.match(html, new RegExp('id="tab-' + panel + '"'));
    assert.match(html, new RegExp('id="demo-' + panel + '"'));
  }
});

test('Documentación: producto ≠ plataforma comercial ≠ datos de clientes', () => {
  const contract = read('hub/ARQUITECTURA-COMERCIAL.md');
  assert.match(contract, /RLS/);
  assert.match(contract, /DAHZEA como asistente comercial/);
  assert.match(contract, /No poner claves de servicio/);
});

test('CITHELA: información comercial no exhibe arquitectura multitenant', () => {
  const html = read(pages[1]);
  assert.match(html, /Tu marca,/);
  assert.match(html, /TU IDENTIDAD/);
  assert.doesNotMatch(html, /cuentas organizacionales|pruebas multitenant|aislamiento entre establecimientos|Cada establecimiento necesita/);
});
test('Dominio: raíz redirige relativamente a la portada de SpukLab', () => {
  const html = read('index.html');
  assert.match(html, /url=\.\/hub\//);
  assert.match(html, /href="\.\/hub\/"/);
});
