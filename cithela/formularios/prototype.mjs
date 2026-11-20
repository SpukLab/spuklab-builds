import {
  createDraft, addField, removeField, publishForm,
  listFormsForService, simulateSubmission, MAX_FIELDS
} from './form-model.mjs';

// Demostración local solo en memoria; no tiene persistencia ni comunicación externa.
const services = {
  peluqueria: [{ id: 'corte', label: 'Corte' }, { id: 'coloracion', label: 'Coloración' }],
  tattoo: [{ id: 'tattoo', label: 'Sesión de tatuaje' }, { id: 'consulta', label: 'Consulta inicial' }],
  consultorio: [{ id: 'consulta', label: 'Consulta' }, { id: 'control', label: 'Control' }]
};
const $ = id => document.getElementById(id);
const ctx = () => ({ tenantId: $('tenant').value, serviceId: $('service').value });
const staff = () => ({ tenantId: ctx().tenantId, role: 'owner' }); // Solo simulación de interfaz.
let forms = [];
let draft = null;
let current = null;
let counter = 0;

const errorText = {
  empty_form: 'Agregá al menos una pregunta.',
  invalid_text: 'Completá el texto y respetá la longitud máxima.',
  invalid_options: 'La elección requiere de 2 a 12 opciones.',
  duplicate_options: 'Las opciones deben ser distintas.',
  field_limit: 'Máximo 15 preguntas por formulario.',
  published_is_immutable: 'Esta versión está publicada. Creá un nuevo borrador.',
  required: 'Falta una respuesta obligatoria.',
  invalid_option: 'Elegí una opción válida.',
  too_long: 'La respuesta supera el límite.',
  unknown_field: 'Se recibieron preguntas no reconocidas.'
};
const message = code => errorText[code] || String(code || 'Revisá los datos.');
const status = (id, text) => { $(id).textContent = text; };
const el = (tag, text, cls) => {
  const item = document.createElement(tag);
  if (text !== undefined && text !== null) item.textContent = text;
  if (cls) item.className = cls;
  return item;
};

function refreshServices() {
  const list = $('service');
  list.replaceChildren();
  for (const service of services[$('tenant').value]) {
    const option = el('option', service.label);
    option.value = service.id;
    list.append(option);
  }
  updateContext();
}
function updateContext() {
  draft = null;
  const found = listFormsForService(forms, ctx()).filter(f => f.status === 'published');
  current = found.at(-1) || null;
  status('status', current ? 'Versión publicada para este servicio (simulación).' : 'No hay formulario publicado para este servicio.');
  render();
}
function render() {
  const editable = draft?.status === 'draft';
  $('editor-area').classList.toggle('hidden', !editable);
  $('publish').disabled = !editable || draft.fields.length === 0;
  if (editable) {
    $('field-count').textContent = draft.fields.length + ' / ' + MAX_FIELDS;
    $('add-field').disabled = draft.fields.length >= MAX_FIELDS;
    const parent = $('fields');
    parent.replaceChildren();
    for (const f of draft.fields) {
      const wrap = el('div', null, 'field');
      const head = el('div', null, 'field-head');
      head.append(el('strong', f.label + (f.required ? ' *' : '')));
      const remove = el('button', 'Quitar', 'danger');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        try {
          draft = removeField(draft, f.id, staff());
          render();
        } catch (err) { status('status', message(err.code)); }
      });
      head.append(remove);
      wrap.append(head, el('div', f.type + (f.options.length ? ': ' + f.options.join(' · ') : ''), 'small'));
      parent.append(wrap);
    }
  }
  renderPreview();
}
function renderPreview() {
  const form = $('preview-form'), list = $('preview-fields');
  form.classList.toggle('hidden', !current);
  list.replaceChildren();
  status('answer-status', '');
  if (!current) {
    $('preview-explainer').textContent = 'Creá el formulario y publicá una versión de prueba para visualizarlo.';
    return;
  }
  $('preview-heading').textContent = current.title;
  $('preview-explainer').textContent = 'Servicio seleccionado · datos ficticios · envío simulado.';
  for (const f of current.fields) {
    const label = el('label', f.label + (f.required ? ' *' : ''));
    label.htmlFor = 'answer-' + f.id;
    let input;
    if (f.type === 'textarea') input = el('textarea');
    else if (f.type === 'select') {
      input = el('select');
      const blank = el('option', 'Seleccioná una opción');
      blank.value = '';
      input.append(blank);
      for (const option of f.options) {
        const item = el('option', option);
        item.value = option;
        input.append(item);
      }
    } else {
      input = el('input');
      input.type = f.type === 'checkbox' ? 'checkbox' : 'text';
      input.maxLength = 200;
    }
    input.id = 'answer-' + f.id;
    input.name = f.id;
    if (f.type === 'checkbox') {
      label.className = 'check';
      label.prepend(input);
      list.append(label);
    } else list.append(label, input);
  }
}
$('tenant').addEventListener('change', refreshServices);
$('service').addEventListener('change', updateContext);
$('field-type').addEventListener('change', () =>
  $('choices-area').classList.toggle('hidden', $('field-type').value !== 'select')
);
$('create').addEventListener('click', () => {
  try {
    counter++;
    draft = createDraft({
      id: 'demo-form-' + counter,
      ...ctx(),
      title: $('form-title').value,
      role: 'owner'
    });
    current = null;
    status('status', 'Borrador creado. Agregá preguntas y publicá la vista previa.');
    render();
  } catch (err) { status('status', message(err.code)); }
});
$('add-field').addEventListener('click', () => {
  if (!draft) return;
  try {
    const type = $('field-type').value;
    const options = type === 'select' ? $('field-options').value.split(';').map(s => s.trim()) : [];
    counter++;
    draft = addField(draft, {
      id: 'demo-field-' + counter,
      label: $('field-label').value,
      type,
      required: $('field-required').checked,
      options
    }, staff());
    $('field-label').value = '';
    $('field-options').value = '';
    $('field-required').checked = false;
    status('status', 'Pregunta agregada al borrador.');
    render();
  } catch (err) { status('status', message(err.code)); }
});
$('publish').addEventListener('click', () => {
  if (!draft) return;
  try {
    current = publishForm(draft, { ...staff(), expectedVersion: draft.version });
    forms.push(current);
    draft = null;
    status('status', 'Vista de prueba publicada solo en memoria. No se guardaron datos.');
    render();
  } catch (err) { status('status', message(err.code)); }
});
$('preview-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!current) return;
  const answers = {};
  for (const f of current.fields) {
    const input = $('answer-' + f.id);
    answers[f.id] = f.type === 'checkbox' ? input.checked : input.value;
  }
  try {
    const result = simulateSubmission({ form: current, ...ctx(), personId: 'persona-ficticia', answers });
    if (!result.ok) {
      const detail = Object.entries(result.errors).map(([id, code]) => {
        const field = current.fields.find(f => f.id === id);
        return (field?.label || 'Formulario') + ': ' + message(code);
      }).join(' · ');
      status('answer-status', detail);
    } else {
      status('answer-status', 'Validación correcta (' + result.summary.answerCount +
        ' preguntas). No se guardó ni transmitió la información.');
    }
  } catch (err) { status('answer-status', message(err.code)); }
});
refreshServices();
