import crypto from "crypto"
import { isIP } from "node:net"
import { get, put } from "@vercel/blob"
import { OfficeParser } from "officeparser"
import { createAdminClient } from "@/lib/supabase/admin"

const MAX_BYTES = 25 * 1024 * 1024
const COMPLETE_TEXT_LIMIT = 120_000
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
])

export type DraftSource = { type: "text"; text: string } | { type: "url"; url: string } | { type: "upload" }

export function hashValue(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function randomToken() {
  return `asci_upload_${crypto.randomBytes(32).toString("base64url")}`
}

function baseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://app.asci.ai"
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true
  if (!isIP(host)) return false
  return host.startsWith("10.") || host.startsWith("127.") || host.startsWith("169.254.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1"
}

function normalizePublicUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== "https:" || isPrivateHost(url.hostname)) throw new Error("Solo se permiten URLs HTTPS públicas")
  const doc = url.pathname.match(/^\/document\/d\/([^/]+)/)
  const slides = url.pathname.match(/^\/presentation\/d\/([^/]+)/)
  const drive = url.pathname.match(/^\/file\/d\/([^/]+)/)
  if (url.hostname === "docs.google.com" && doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=pdf`
  if (url.hostname === "docs.google.com" && slides) return `https://docs.google.com/presentation/d/${slides[1]}/export/pdf`
  if ((url.hostname === "drive.google.com" || url.hostname === "docs.google.com") && drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`
  return url.toString()
}

async function fetchPublicDocument(rawUrl: string) {
  let current = normalizePublicUrl(rawUrl)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "ASCI-Document-Ingestion/1.0" } })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new Error("La URL redirige sin destino")
      current = normalizePublicUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok) throw new Error(`No se pudo descargar el documento (${response.status})`)
    const length = Number(response.headers.get("content-length") || 0)
    if (length > MAX_BYTES) throw new Error("El documento supera 25 MB")
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_BYTES) throw new Error("El documento supera 25 MB")
    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase()
    if (contentType === "text/html") throw new Error("La URL devolvió una página HTML. En Drive habilita 'Cualquier persona con el enlace'.")
    return { buffer, contentType }
  }
  throw new Error("La URL tiene demasiadas redirecciones")
}

async function parseDocument(buffer: Buffer) {
  const ast = await OfficeParser.parseOffice(buffer, { ocr: false })
  return (await ast.to("text")).value.trim()
}

export async function createDocumentDraft(input: { workspaceId: string; userId: string; title: string; source: DraftSource }) {
  const admin = createAdminClient()
  let text: string | null = null
  let mimeType: string | null = null
  let storagePath: string | null = null
  let sourceUrl: string | null = null
  let status = "pending_upload"
  let contentHash: string | null = null

  if (input.source.type === "text") {
    text = input.source.text.trim()
    if (!text) throw new Error("El texto no puede estar vacío")
    contentHash = hashValue(text)
    mimeType = "text/plain"
    status = "ready_for_analysis"
  } else if (input.source.type === "url") {
    sourceUrl = input.source.url
    const downloaded = await fetchPublicDocument(sourceUrl)
    if (!ALLOWED_TYPES.has(downloaded.contentType) && !downloaded.contentType.includes("octet-stream")) throw new Error("Formato de URL no permitido")
    contentHash = hashValue(downloaded.buffer)
    const duplicate = await findDuplicate(input.workspaceId, contentHash)
    if (duplicate) return { ...duplicate, reused: true }
    text = await parseDocument(downloaded.buffer)
    mimeType = downloaded.contentType
    const blob = await put(`v3/documents/${input.workspaceId}/${contentHash}`, downloaded.buffer, { access: "private", contentType: mimeType, addRandomSuffix: false })
    storagePath = blob.pathname
    status = "ready_for_analysis"
  }

  if (contentHash) {
    const duplicate = await findDuplicate(input.workspaceId, contentHash)
    if (duplicate) return { ...duplicate, reused: true }
  }

  const { data: draft, error } = await admin.schema("v3").from("mcp_document_drafts").insert({
    workspace_id: input.workspaceId, created_by: input.userId, title: input.title, source_type: input.source.type,
    source_url: sourceUrl, storage_path: storagePath, mime_type: mimeType, content_hash: contentHash,
    extracted_text: text, status,
  }).select("id,title,status,expires_at").single()
  if (error) throw error

  if (input.source.type !== "upload") return { ...draft, reused: false }
  const token = randomToken()
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
  const { error: tokenError } = await admin.schema("v3").from("mcp_document_upload_tokens").insert({ draft_id: draft.id, workspace_id: input.workspaceId, user_id: input.userId, token_hash: hashValue(token), expires_at: expiresAt })
  if (tokenError) throw tokenError
  return { ...draft, reused: false, uploadUrl: `${baseUrl()}/v3/mcp/upload/${token}`, uploadExpiresAt: expiresAt, instructions: "Abre el enlace y carga un PDF, DOCX o PPTX de hasta 25 MB. El enlace vence en 15 minutos y se usa una sola vez." }
}

async function findDuplicate(workspaceId: string, contentHash: string) {
  const { data } = await createAdminClient().schema("v3").from("mcp_document_drafts")
    .select("id,title,status,confirmed_document_id,expires_at").eq("workspace_id", workspaceId).eq("content_hash", contentHash).neq("status", "expired").maybeSingle()
  return data
}

export async function consumeUploadToken(token: string, file: File) {
  if (file.size > MAX_BYTES || !ALLOWED_TYPES.has(file.type)) throw new Error("Archivo inválido. Usa PDF, DOCX o PPTX de hasta 25 MB.")
  const admin = createAdminClient()
  const { data: row } = await admin.schema("v3").from("mcp_document_upload_tokens").select("id,draft_id,workspace_id,used_at,expires_at").eq("token_hash", hashValue(token)).maybeSingle()
  if (!row || row.used_at || new Date(row.expires_at) <= new Date()) throw new Error("El enlace venció o ya fue utilizado")
  const buffer = Buffer.from(await file.arrayBuffer())
  const contentHash = hashValue(buffer)
  const duplicate = await findDuplicate(row.workspace_id, contentHash)
  if (duplicate && duplicate.id !== row.draft_id) {
    await admin.schema("v3").from("mcp_document_upload_tokens").update({ used_at: new Date().toISOString() }).eq("id", row.id)
    return { draftId: duplicate.id, reused: true }
  }
  const text = await parseDocument(buffer)
  const blob = await put(`v3/documents/${row.workspace_id}/${contentHash}`, buffer, { access: "private", contentType: file.type, addRandomSuffix: false })
  await admin.schema("v3").from("mcp_document_upload_tokens").update({ used_at: new Date().toISOString() }).eq("id", row.id)
  const { error } = await admin.schema("v3").from("mcp_document_drafts").update({ storage_path: blob.pathname, mime_type: file.type, file_size: file.size, content_hash: contentHash, extracted_text: text, status: "ready_for_analysis", updated_at: new Date().toISOString() }).eq("id", row.draft_id)
  if (error) throw error
  return { draftId: row.draft_id, reused: false }
}

export async function getDraftText(workspaceId: string, draftId: string, offset = 0) {
  const { data: draft } = await createAdminClient().schema("v3").from("mcp_document_drafts").select("id,title,status,extracted_text,expires_at").eq("id", draftId).eq("workspace_id", workspaceId).maybeSingle()
  if (!draft) throw new Error("Borrador no encontrado")
  if (draft.status !== "ready_for_analysis" && draft.status !== "confirmed") return { id: draft.id, title: draft.title, status: draft.status, ready: false }
  const text = draft.extracted_text || ""
  const content = text.slice(offset, offset + COMPLETE_TEXT_LIMIT)
  const nextOffset = offset + content.length < text.length ? offset + content.length : null
  return { id: draft.id, title: draft.title, status: draft.status, ready: true, content, totalCharacters: text.length, complete: nextOffset === null, nextOffset }
}

export async function readPrivateDraftFile(pathname: string) {
  return get(pathname, { access: "private" })
}
