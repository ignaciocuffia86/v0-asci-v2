// ═══════════════════════════════════════════════════════════
// Reparto de los cambios del diccionario en dos carriles.
//
// No todos los cambios merecen la misma urgencia:
//
//   inmediato → agregar o sacar una keyword. El editor acaba de tocarlo y
//     quiere ver el efecto. Lo toma el cron que corre cada minuto.
//
//   nocturno → cambiar keywords_contexto o keywords_excluye de una keyword que
//     YA existe. Obliga a rehacer señales que ya están y que nadie está
//     esperando: reprocesar "Exchange" toca ~5.000 contactos. Compite con el
//     trabajo interactivo sin ganar nada, así que se encola 'deferred' y lo
//     libera /api/cron/dictionary-reprocess de madrugada.
//
// Vive fuera del componente para poder fijarlo con tests: que un recálculo se
// vuelva a colar en el carril inmediato es justamente la regresión que
// devolvería el problema que este reparto resuelve.
// ═══════════════════════════════════════════════════════════

export type PendingChangeType = "add" | "remove" | "recalculate"

export type PendingChange = {
  type: PendingChangeType
  keyword: string
}

export type ImmediateJob = {
  job_type: "add_keyword" | "remove_keyword"
  signal_id: string
  signal_type: string
  keyword: string
  status: "pending"
}

export type JobPlan = {
  /** Se insertan directo en dictionary_jobs. Los drena el cron del minuto. */
  inmediatos: ImmediateJob[]
  /** Keywords para enqueue_dictionary_recalc, que encola el par diferido. */
  recalcs: string[]
}

export function planDictionaryJobs(
  changes: PendingChange[],
  signalId: string,
  signalType: string,
): JobPlan {
  const job = (keyword: string, job_type: ImmediateJob["job_type"]): ImmediateJob => ({
    job_type,
    signal_id: signalId,
    signal_type: signalType,
    keyword,
    status: "pending",
  })

  // Los remove van antes que los add. En el carril inmediato son keywords
  // distintas, así que el orden no cambia el resultado, pero mantenerlo deja
  // una sola convención para las dos rutas: en el carril nocturno, donde las
  // dos operaciones caen sobre la MISMA keyword, el orden sí es la diferencia
  // entre recalcular y borrar.
  const inmediatos = [
    ...changes.filter((c) => c.type === "remove").map((c) => job(c.keyword, "remove_keyword")),
    ...changes.filter((c) => c.type === "add").map((c) => job(c.keyword, "add_keyword")),
  ]

  const recalcs = changes.filter((c) => c.type === "recalculate").map((c) => c.keyword)

  return { inmediatos, recalcs }
}
