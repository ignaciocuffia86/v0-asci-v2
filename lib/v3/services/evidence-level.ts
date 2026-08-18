/**
 * Se mudó a `lib/shared/evidence-level.ts`.
 *
 * El módulo es puro y lo necesitan las tres zonas (v2, v3 y el escritor común
 * de evidencia), así que vive en `lib/shared/`: `lib/shared/evidence.ts` no
 * puede depender de `lib/v3` sin invertir la dependencia que la auditoría pide
 * (P1.3). Este archivo queda como reexport para no tocar a los 5 importadores
 * de una sola vez.
 */
export * from "@/lib/shared/evidence-level"
