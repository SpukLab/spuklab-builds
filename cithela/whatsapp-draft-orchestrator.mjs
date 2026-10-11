import { classifyRequest, matchService, proposeSlots, draftProposal } from "./whatsapp-slot-proposals.mjs";

/**
 * Read-only supervised draft builder.
 * adapter.command(command, payload): Promise<{ok, items?, slots?, date?, code?}>
 * adapter must scope all calls to the inbound event's authenticated tenant/connection.
 * No inbox claim, completion, send, or appointment mutation occurs here.
 */
export async function prepareInboundDraft(event, adapter, options = {}) {
  if (!event || event.channel !== "whatsapp" || event.message_type !== "text" ||
      !event.external_event_id || !event.connection_id || !event.tenant_id) {
    return { status: "ignored", reason: "unsupported_event" };
  }
  const intent = classifyRequest(event.text_body);
  if (intent === "unknown") return { status: "needs_review", intent, reason: "unrecognized_intent" };
  if (intent !== "book") return { status: "needs_review", intent, reason: "requires_identity_and_confirmation" };

  const catalog = await adapter.command("catalog.services", {});
  if (!catalog?.ok || !Array.isArray(catalog.items)) {
    return { status: "needs_review", intent, reason: "services_unavailable" };
  }
  const service = matchService(event.text_body, catalog.items);
  if (!service) return { status: "draft", intent, service: null, slots: [], ...draftProposal(null, []) };

  const resources = await adapter.command("catalog.resources", {});
  if (!resources?.ok || !Array.isArray(resources.items) || resources.items.length !== 1) {
    return { status: "needs_review", intent, reason: "resource_selection_required" };
  }
  const resource = resources.items[0];
  const dates = Array.isArray(options.dates) ? [...new Set(options.dates)] : [];
  if (dates.length === 0 || dates.length > 7 || dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    return { status: "needs_review", intent, reason: "date_window_required" };
  }
  const days = [];
  for (const date of dates) {
    const availability = await adapter.command("availability.query", {
      date, service_id: service.id, resource_id: resource.id
    });
    if (!availability?.ok || availability.date !== date || !Array.isArray(availability.slots)) {
      return { status: "needs_review", intent, reason: "availability_unavailable" };
    }
    days.push({ date, slots: availability.slots });
  }
  const slots = proposeSlots(days, { limit: 3, requestedDate: options.requestedDate, afterTime: options.afterTime });
  const proposal = draftProposal(service, slots);
  return {
    status: "draft", intent, tenant_id: event.tenant_id, connection_id: event.connection_id,
    external_event_id: event.external_event_id, service_id: service.id,
    resource_id: resource.id, timezone: catalog.timezone, slots,
    proposal_status: proposal.status, text: proposal.text,
    review_required: true, send_enabled: false, booking_enabled: false
  };
}
