// CITHELA · plantillas iniciales para formularios multirrubro.
// Catálogo editorial ficticio: no hay datos reales ni historias clínicas.
// Esta biblioteca no realiza llamadas externas ni guarda información.
import { createDraft, addField } from './form-model.mjs';

const DEFINITIONS = Object.freeze([
  {
    id: 'basico',
    name: 'Contacto y preferencias',
    activity: 'all',
    description: 'Un formulario breve, útil para cualquier servicio.',
    title: 'Antes de tu turno',
    fields: [
      { id: 'contacto', label: '¿Cómo preferís que te contactemos?', type: 'select', required: true, options: ['WhatsApp', 'Correo electrónico', 'Teléfono'] },
      { id: 'preferencia', label: '¿Tenés alguna preferencia de horario?', type: 'select', required: false, options: ['Mañana', 'Tarde', 'Sin preferencia'] }
    ]
  },
  {
    id: 'peluqueria',
    name: 'Peluquería · preparación',
    activity: 'peluqueria',
    description: 'Preferencias administrativas para corte o coloración.',
    title: 'Preparación de tu visita',
    fields: [
      { id: 'servicio', label: '¿Es tu primera visita al establecimiento?', type: 'select', required: true, options: ['Sí', 'No'] },
      { id: 'referencias', label: '¿Traés imágenes de referencia para el estilo?', type: 'select', required: false, options: ['Sí', 'No'] },
      { id: 'contacto', label: '¿Cómo preferís recibir avisos?', type: 'select', required: true, options: ['WhatsApp', 'Correo electrónico'] }
    ]
  },
  {
    id: 'tatuajes',
    name: 'Tatuajes · consulta inicial',
    activity: 'tattoo',
    description: 'Preferencias de diseño, sin consultas médicas.',
    title: 'Consulta de diseño',
    fields: [
      { id: 'diseno', label: '¿Ya tenés un diseño definido?', type: 'select', required: true, options: ['Sí', 'Quiero asesoramiento'] },
      { id: 'tamano', label: '¿Qué tamaño aproximado considerás?', type: 'select', required: false, options: ['Pequeño', 'Mediano', 'Grande', 'A definir'] },
      { id: 'contacto', label: '¿Cómo preferís recibir novedades del turno?', type: 'select', required: true, options: ['WhatsApp', 'Correo electrónico'] }
    ]
  },
  {
    id: 'asesoria',
    name: 'Asesoría · modalidad',
    activity: 'all',
    description: 'Organización de una consulta profesional no clínica.',
    title: 'Antes de la reunión',
    fields: [
      { id: 'modalidad', label: '¿Cómo preferís realizar la reunión?', type: 'select', required: true, options: ['Presencial', 'Videollamada'] },
      { id: 'confirmacion', label: 'Confirmo que conozco la fecha y duración de la cita', type: 'checkbox', required: true },
      { id: 'contacto', label: '¿Por qué canal preferís recibir cambios de horario?', type: 'select', required: false, options: ['WhatsApp', 'Correo electrónico'] }
    ]
  }
]);

const fail = code => { const error = new Error(code); error.code = code; throw error; };
export function listPresetChoices(activity) {
  if (typeof activity !== 'string' || !activity.trim()) fail('invalid_activity');
  return DEFINITIONS.filter(preset => preset.activity === 'all' || preset.activity === activity)
    .map(({id,name,description,activity}) => ({id,name,description,activity}));
}

export function instantiatePreset({ presetId, tenantId, serviceId, id, role, title }) {
  const preset = DEFINITIONS.find(candidate => candidate.id === presetId);
  if (!preset) fail('preset_not_found');
  // El control del rubro es editorial; no es un permiso de servidor.
  const values = { tenantId, serviceId, role };
  let form = createDraft({
    ...values,
    id,
    title: title === undefined ? preset.title : title
  });
  for (const field of preset.fields) form = addField(form, {
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options ? [...field.options] : []
  }, {tenantId,role});
  return form;
}
