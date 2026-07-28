// Stub temporal: permite ejecutar módulos marcados con "server-only" fuera de Next.
const Module = require("module")
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === "server-only" || request === "client-only") return {}
  return originalLoad.apply(this, [request, parent, isMain])
}
