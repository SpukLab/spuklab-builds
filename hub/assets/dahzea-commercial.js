/* DAHZEA · orientación comercial inicial para SpukLab.
 * Funciona en GitHub Pages sin APIs, persistencia ni datos privados.
 * NO es el motor conversacional LLM de DAHZEA: ese requiere backend aislado.
 */
(function () {
  'use strict';
  const root = document.querySelector('[data-dahzea-guide]');
  if (!root) return;
  const transcript = root.querySelector('[data-guide-messages]');
  const choices = root.querySelector('[data-guide-choices]');
  const restart = root.querySelector('[data-guide-restart]');

  const products = {
    cithela: {
      name: 'CITHELA',
      status: 'Piloto con incorporación asistida',
      url: 'productos/cithela/',
      message: 'CITHELA permite organizar turnos, servicios y disponibilidad, con identidad propia y comunicación vinculada a las reservas.',
      intent: 'Agenda y reservas'
    },
    dahzea: {
      name: 'DAHZEA',
      status: 'Piloto operativo supervisado',
      url: 'productos/dahzea/',
      message: 'DAHZEA reúne atención comercial, ventas observadas en Mercado Libre, preparación de pedidos, envíos y posventa. Algunas automatizaciones requieren supervisión.',
      intent: 'Comercio y operaciones'
    },
    surkara: {
      name: 'SURKARA',
      status: 'En desarrollo: no disponible para contratar',
      url: '#surkara',
      message: 'SURKARA está pensado para coordinar recursos, operadores, transporte y tareas de campo, incluso con conectividad limitada.',
      intent: 'Operaciones de campo y logística'
    }
  };

  const entries = {
    inicio: {
      question: 'Hola, soy DAHZEA, el asistente comercial de SpukLab. ¿Qué necesitás organizar o mejorar?',
      options: [
        ['Agenda y turnos', 'agenda'],
        ['Ventas y pedidos', 'ventas'],
        ['Campo y transporte', 'campo'],
        ['No sé qué producto necesito', 'orientar']
      ]
    },
    agenda: {
      question: 'Perfecto. ¿Cómo trabajás con los turnos?',
      options: [['Trabajo por mi cuenta', 'cithela-solo'], ['Tenemos un equipo', 'cithela-equipo'], ['Solo quiero conocer la propuesta', 'cithela-info']]
    },
    ventas: {
      question: '¿Qué parte de la operación comercial necesita más atención?',
      options: [['Responder consultas', 'dahzea-consultas'], ['Preparar pedidos y envíos', 'dahzea-empaque'], ['Cambios y posventa', 'dahzea-posventa']]
    },
    campo: {
      question: '¿Qué te interesa coordinar?',
      options: [['Operadores y recursos', 'surkara-recursos'], ['Movimientos y transporte', 'surkara-transporte'], ['Trabajo con poca señal', 'surkara-offline']]
    },
    orientar: {
      question: 'Te ayudo a elegir. ¿Qué actividad se parece más a la tuya?',
      options: [['Atiendo personas con reserva', 'agenda'], ['Vendo productos online', 'ventas'], ['Organizo tareas de campo o transporte', 'campo']]
    }
  };

  const outcomes = {
    'cithela-solo': ['cithela', 'Podés comenzar por una agenda para tu actividad y definir servicios y horarios.'],
    'cithela-equipo': ['cithela', 'CITHELA permite trabajar con cuentas de profesionales y servicios; confirmaremos la configuración adecuada durante el piloto.'],
    'cithela-info': ['cithela', 'Podés explorar la página del producto y consultar el alcance del piloto antes de incorporarte.'],
    'dahzea-consultas': ['dahzea', 'El asistente atiende preguntas de publicaciones con fuentes y reglas autorizadas; la respuesta automática depende de los controles habilitados.'],
    'dahzea-empaque': ['dahzea', 'El flujo de búsqueda, empaque y evidencia física se mantiene separado del estado logístico informado por Mercado Libre.'],
    'dahzea-posventa': ['dahzea', 'Podés revisar mensajes, casos e instrucciones vinculadas a ventas, con validación humana en acciones sensibles.'],
    'surkara-recursos': ['surkara', 'El objetivo es organizar recursos, operadores y la actividad cotidiana del campo.'],
    'surkara-transporte': ['surkara', 'SURKARA apunta a mejorar la coordinación entre movimientos, transporte y tareas de campo.'],
    'surkara-offline': ['surkara', 'Su enfoque incluye el registro móvil con conectividad intermitente.']
  };

  const el = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };

  function say(text, by) {
    const p = el('p', 'guide-message ' + (by === 'visitor' ? 'guide-visitor' : 'guide-dahzea'), text);
    transcript.appendChild(p);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function option(label, action) {
    const b = el('button', 'guide-option', label);
    b.type = 'button';
    b.addEventListener('click', () => select(action, label));
    return b;
  }

  function clearOptions() { choices.replaceChildren(); }

  function showQuestion(id) {
    const entry = entries[id];
    if (!entry) return;
    say(entry.question, 'guide');
    clearOptions();
    for (const [label, action] of entry.options) choices.appendChild(option(label, action));
  }

  function recommend(outcomeId) {
    const outcome = outcomes[outcomeId];
    if (!outcome) return;
    const [id, context] = outcome;
    const product = products[id];
    say(context + ' Mi recomendación inicial es ' + product.name + '. ' + product.message, 'guide');
    clearOptions();
    const status = el('p', 'guide-product-status', product.status);
    choices.appendChild(status);
    const actions = el('div', 'guide-results');
    const details = el('a', 'guide-result-primary', 'Conocer ' + product.name + ' ↗');
    details.href = product.url;
    const contact = el('a', 'guide-result-secondary', id === 'surkara' ? 'Consultar sobre el desarrollo ↗' : 'Solicitar orientación para el piloto ↗');
    const subject = 'Consulta SpukLab: ' + product.name;
    const body = 'Hola, quisiera consultar por ' + product.name + '.\nTema: ' + product.intent + '.\nInterés: ' + context;
    contact.href = 'mailto:spuklab@gmail.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    actions.append(details, contact);
    choices.appendChild(actions);
    const note = el('p', 'guide-fineprint', 'El contacto abre tu correo. No realizamos cobros ni habilitamos cuentas desde este asistente.');
    choices.appendChild(note);
  }

  function select(id, label) {
    if (!label) return;
    say(label, 'visitor');
    if (Object.hasOwn(entries, id)) showQuestion(id);
    else recommend(id);
  }

  function reset() {
    transcript.replaceChildren();
    clearOptions();
    showQuestion('inicio');
  }
  restart.addEventListener('click', reset);
  reset();
})();
