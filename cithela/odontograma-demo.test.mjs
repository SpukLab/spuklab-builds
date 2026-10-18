import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const file = join(dirname(fileURLToPath(import.meta.url)), 'odontograma-demo.html');
const html = readFileSync(file, 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'expected an inline script');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this._text = '';
    this.innerHTML = '';
    this.value = '';
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  click() { assert.ok(this.listeners.click, 'element has a click handler'); this.listeners.click(); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
}

function setup() {
  const elements = new Map();
  const document = {
    createElement(tag) { return new Element(tag); },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    }
  };
  document.getElementById('finding').value = 'caries';
  runInNewContext(match[1], { document, Set, Date, Intl });
  return id => document.getElementById(id);
}

test('32 FDI permanent teeth render in four quadrants', () => {
  const get = setup();
  const quadrants = get('quadrants').children;
  assert.equal(quadrants.length, 4);
  const buttons = quadrants.flatMap(section => section.children[1].children);
  const actual = buttons.map(button => button.getAttribute('aria-label').match(/\d{2}/)[0]);
  const expected = [
    '18','17','16','15','14','13','12','11',
    '21','22','23','24','25','26','27','28',
    '48','47','46','45','44','43','42','41',
    '31','32','33','34','35','36','37','38'
  ];
  assert.deepEqual(actual, expected);
  assert.equal(get('selection-heading').textContent, 'Pieza 11 · Incisal');
});

test('select tooth and surface with accessible toggles', () => {
  const get = setup();
  get('quadrants').children[0].children[1].children[0].click(); // Tooth 18
  assert.equal(get('selection-heading').textContent, 'Pieza 18 · Oclusal');
  assert.equal(get('surfaces').children.length, 6);
  get('surfaces').children[2].click(); // Vestibular
  assert.equal(get('selection-heading').textContent, 'Pieza 18 · Vestibular');
  assert.equal(get('surfaces').children[2].getAttribute('aria-pressed'), 'true');
});

test('surface cannot be marked absent, only whole tooth', () => {
  const get = setup();
  get('finding').value = 'ausente';
  get('save').click();
  assert.equal(get('history').children.length, 1);
  assert.match(get('history').textContent, /Todavía no hay observaciones/);
  assert.match(get('message').textContent, /Combinación no válida/);
  get('surfaces').children[0].click(); // Entire tooth
  get('save').click();
  assert.equal(get('history').children.length, 1);
  assert.match(get('history').textContent, /Pieza 11 · Pieza completa · Pieza ausente/);
  const tooth11 = get('quadrants').children[0].children[1].children[7];
  assert.match(tooth11.getAttribute('aria-label'), /ausente/);
});

test('demo example, correction and reset maintain chronological events', () => {
  const get = setup();
  get('seed').click();
  assert.equal(get('history').children.length, 4);
  assert.match(get('history').children[0].textContent, /Pieza 48/);
  assert.equal(get('quadrants').children[2].children[1].children[0].getAttribute('aria-label'), 'Pieza 48, ausente');
  get('quadrants').children[2].children[1].children[0].click();
  get('surfaces').children[0].click();
  get('finding').value = 'sin_registro';
  get('save').click();
  assert.equal(get('history').children.length, 5);
  assert.equal(get('quadrants').children[2].children[1].children[0].getAttribute('aria-label'), 'Pieza 48');
  get('reset').click();
  assert.match(get('history').textContent, /Todavía no hay observaciones/);
});

test('notes are displayed as text, not HTML', () => {
  const get = setup();
  const unsafe = '<img src=x onerror=alert(1)>';
  get('detail').value = unsafe;
  get('save').click();
  const event = get('history').children[0];
  assert.equal(event.children[2].textContent, unsafe);
  assert.equal(event.children[2].innerHTML, '');
});

test('no persistence, patient identifiers or remote API access in the demo', () => {
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest/);
  assert.doesNotMatch(html, /supabase\.(?:from|rpc|auth)|patient_id|person_id/);
  assert.match(html, /no está conectada a Supabase/i);
});
