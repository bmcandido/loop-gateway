/**
 * Add-on serializando JsonObject/JsonArray de outra cópia do Gson devolve {"members": {...}} e
 * {"elements": [...]}. O app espera o JSON normal: desembrulha (correção definitiva no BaseResponse
 * do add-on; isto cobre add-ons ainda não atualizados).
 */
export function desembrulhar(v: unknown): any {
  if (Array.isArray(v)) return v.map(desembrulhar);
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const chaves = Object.keys(o);
  if (chaves.length === 1 && chaves[0] === 'members' && o.members && typeof o.members === 'object' && !Array.isArray(o.members)) return desembrulhar(o.members);
  if (chaves.length === 1 && chaves[0] === 'elements' && Array.isArray(o.elements)) return desembrulhar(o.elements);
  const r: Record<string, unknown> = {};
  for (const k of chaves) r[k] = desembrulhar(o[k]);
  return r;
}
