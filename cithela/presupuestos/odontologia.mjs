// CITHELA — cobertura odontológica (vista preliminar, sin consulta a prestadores).
// No almacena credenciales, número de afiliación ni información clínica.
const KINDS = Object.freeze(["particular", "obra_social", "prepaga"]);
const STATES = Object.freeze(["sin_verificar", "pendiente", "autorizada", "rechazada"]);
const MAX_MINOR = 100_000_000_000;

function safeMinor(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR) {
    throw new RangeError(label + " inválido.");
  }
  return value;
}

function safeName(value, label, max) {
  const text = String(value ?? "").trim();
  if (text.length > max || /[\\r\\n\\t]/.test(text)) throw new RangeError(label + " inválido.");
  return text;
}

/**
 * Snapshot administrativo: importe de cobertura cargado MANUALMENTE.
 * Cuando no está autorizada la cobertura, el copago queda indeterminado.
 */
export function normalizeDentalCoverage(data, totalMinor) {
  safeMinor(totalMinor, "Total");
  const kind = data?.kind ?? "particular";
  if (!KINDS.includes(kind)) throw new RangeError("Tipo de atención inválido.");
  if (kind === "particular") {
    return Object.freeze({kind, provider: "", plan: "", status: "sin_verificar", coveredMinor: null});
  }
  const provider = safeName(data?.provider, "Obra social / prepaga", 100);
  const plan = safeName(data?.plan, "Plan", 80);
  const status = data?.status ?? "sin_verificar";
  if (provider.length < 2) throw new RangeError("Indicá la obra social o prepaga.");
  if (!STATES.includes(status)) throw new RangeError("Estado de autorización inválido.");
  const amount = data?.coveredMinor ?? null;
  if (status === "autorizada") {
    safeMinor(amount, "Importe reconocido");
    if (amount > totalMinor) throw new RangeError("La cobertura supera el total.");
  } else if (amount !== null) {
    throw new RangeError("No informes un importe reconocido sin autorización.");
  }
  return Object.freeze({kind, provider, plan, status, coveredMinor: amount});
}

export function dentalPaymentBreakdown(totalMinor, data) {
  const coverage = normalizeDentalCoverage(data, totalMinor);
  const hasApprovedAmount = coverage.kind !== "particular" && coverage.status === "autorizada";
  return Object.freeze({
    totalMinor,
    coverage,
    // Un monto estimado de bolsillo solo se muestra cuando un profesional cargó
    // manualmente el importe autorizado. No se infiere cobertura desde un plan.
    patientMinor: coverage.kind === "particular" ? totalMinor :
      (hasApprovedAmount ? totalMinor - coverage.coveredMinor : null),
    coveredMinor: hasApprovedAmount ? coverage.coveredMinor : null
  });
}

export function dentalCoverageNote(totalMinor, data, money) {
  const {coverage, patientMinor, coveredMinor} = dentalPaymentBreakdown(totalMinor, data);
  if (coverage.kind === "particular") return "Atención particular.";
  const label = coverage.kind === "obra_social" ? "Obra social" : "Prepaga";
  const line = label + ": " + coverage.provider + (coverage.plan ? " · Plan " + coverage.plan : "");
  if (coveredMinor === null) {
    return line + "\\nCobertura: " + ({
      sin_verificar: "sin verificar", pendiente: "autorización pendiente",
      rechazada: "no autorizada"
    }[coverage.status]) + ".\\nEl importe a cargo del paciente no está confirmado.";
  }
  return line + "\\nAutorización registrada manualmente por el profesional." +
    "\\nMonto reconocido informado: " + money(coveredMinor) +
    "\\nDiferencia estimada del paciente: " + money(patientMinor) +
    "\\nSujeto a confirmación de la entidad; no constituye autorización ni factura.";
}
