// CITHELA Presupuestos — lógica pura, sin acceso a pacientes ni almacenamiento.
export const CURRENCY = "ARS";
const MAX_MINOR = 100_000_000_000;

export function pesosToMinor(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(normalized)) {
    throw new RangeError("Ingresá un importe válido, con hasta dos decimales.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) throw new RangeError("Importe fuera de rango.");
  return minor;
}

export function moneyARS(minor) {
  validateMinor(minor, "Importe");
  return new Intl.NumberFormat("es-AR", {style:"currency",currency:CURRENCY,maximumFractionDigits:2}).format(minor / 100);
}

function validateMinor(minor, label) {
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_MINOR) {
    throw new RangeError(label + " inválido.");
  }
}

export function makeLine({name, unitMinor, quantity=1}) {
  const title = String(name ?? "").trim();
  if (!title || title.length > 160) throw new RangeError("El servicio debe tener entre 1 y 160 caracteres.");
  validateMinor(unitMinor, "Precio");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new RangeError("Cantidad inválida.");
  const totalMinor = unitMinor * quantity;
  validateMinor(totalMinor, "Total de línea");
  return Object.freeze({name:title,unitMinor,quantity,totalMinor});
}

export function calculateQuote(lines, discountMinor=0) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) {
    throw new RangeError("El presupuesto debe incluir entre 1 y 50 conceptos.");
  }
  validateMinor(discountMinor, "Descuento");
  const snapshot = lines.map(line => makeLine(line));
  const subtotalMinor = snapshot.reduce((sum, line) => sum + line.totalMinor, 0);
  validateMinor(subtotalMinor, "Subtotal");
  if (discountMinor > subtotalMinor) throw new RangeError("El descuento supera el subtotal.");
  return Object.freeze({currency:CURRENCY,lines:Object.freeze(snapshot),subtotalMinor,discountMinor,totalMinor:subtotalMinor-discountMinor});
}

export function whatsappSummary({professional, patient, reference, validity, quote}) {
  if (!quote || quote.currency !== CURRENCY || !Array.isArray(quote.lines)) throw new TypeError("Presupuesto inválido.");
  const header = ["*Presupuesto estimado*", "Profesional: " + String(professional ?? "").trim(),
    "Paciente: " + String(patient ?? "").trim(),
    "Referencia: " + String(reference ?? "").trim(), ""];
  const items = quote.lines.map(line => "• " + line.name + " × " + line.quantity + ": " + moneyARS(line.totalMinor));
  const bottom = ["", "Subtotal: " + moneyARS(quote.subtotalMinor),
    ...(quote.discountMinor ? ["Descuento: −" + moneyARS(quote.discountMinor)] : []),
    "*Total estimado: " + moneyARS(quote.totalMinor) + "*",
    "Validez: " + String(validity ?? "").trim(),
    "Sujeto a evaluación y confirmación profesional."];
  return [...header,...items,...bottom].join("\n");
}

const allowed = Object.freeze({
  borrador:["enviado","rechazado"],
  enviado:["aceptado","rechazado"],
  aceptado:[],
  rechazado:[]
});
export function transitionStatus(current, next) {
  if (!allowed[current]?.includes(next)) throw new RangeError("Cambio de estado no permitido.");
  return next;
}
