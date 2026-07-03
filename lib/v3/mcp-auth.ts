import { createAdminClient } from "@/lib/supabase/admin"
import crypto from "crypto"
import { NextRequest } from "next/server"

// ═══════════════════════════════════════════════════════════
// MCP AUTH MIDDLEWARE
// Validates API keys and rate limits for MCP endpoints
// ═══════════════════════════════════════════════════════════

export interface McpAuthResult {
  success: boolean
  workspaceId?: string
  keyId?: string
  scopes?: string[]
  error?: {
    code: string
    message: string
    status: number
  }
}

export interface McpResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
  meta?: {
    requestId: string
    timestamp: string
  }
}

/**
 * Validates the API key from the Authorization header
 * and checks rate limits
 */
export async function validateMcpRequest(req: NextRequest): Promise<McpAuthResult> {
  const authHeader = req.headers.get("Authorization")
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid Authorization header. Use: Bearer <api_key>",
        status: 401
      }
    }
  }
  
  const apiKey = authHeader.replace("Bearer ", "")
  
  if (!apiKey.startsWith("asci_")) {
    return {
      success: false,
      error: {
        code: "INVALID_KEY_FORMAT",
        message: "Invalid API key format",
        status: 401
      }
    }
  }
  
  // Hash the key to compare with stored hash
  const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex")
  
  const admin = createAdminClient()
  
  // Find the key
  const { data: keyData, error: keyError } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .select("id, workspace_id, rate_limit_per_minute, revoked_at, scopes")
    .eq("key_hash", keyHash)
    .single()
    
  if (keyError || !keyData) {
    return {
      success: false,
      error: {
        code: "INVALID_KEY",
        message: "Invalid API key",
        status: 401
      }
    }
  }
  
  if (keyData.revoked_at) {
    return {
      success: false,
      error: {
        code: "KEY_REVOKED",
        message: "This API key has been revoked",
        status: 401
      }
    }
  }
  
  // Check rate limit
  const rateLimit = keyData.rate_limit_per_minute || 60
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
  
  const { count: recentRequests } = await admin
    .schema("v3")
    .from("mcp_request_logs")
    .select("*", { count: "exact", head: true })
    .eq("api_key_id", keyData.id)
    .gte("created_at", oneMinuteAgo)
    
  if ((recentRequests || 0) >= rateLimit) {
    return {
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded. Maximum ${rateLimit} requests per minute.`,
        status: 429
      }
    }
  }
  
  // Update last_used_at and request_count
  await admin
    .schema("v3")
    .from("mcp_api_keys")
    .update({
      last_used_at: new Date().toISOString(),
      request_count: (keyData as any).request_count + 1 || 1
    })
    .eq("id", keyData.id)
  
  return {
    success: true,
    workspaceId: keyData.workspace_id,
    keyId: keyData.id,
    scopes: Array.isArray((keyData as { scopes?: string[] }).scopes)
      ? (keyData as { scopes?: string[] }).scopes
      : ["read"],
  }
}

/**
 * Logs an MCP request for analytics and rate limiting
 */
export async function logMcpRequest(
  keyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTimeMs: number
): Promise<void> {
  const admin = createAdminClient()
  
  // Fire and forget - no await needed for logging
  admin
    .schema("v3")
    .from("mcp_request_logs")
    .insert({
      api_key_id: keyId,
      endpoint,
      method,
      status_code: statusCode,
      response_time_ms: responseTimeMs
    })
    .then(() => {}, (err: Error) => console.error("Error logging MCP request:", err))
}

/**
 * Creates a standard MCP response
 */
export function mcpResponse<T>(
  data: T,
  requestId?: string
): McpResponse<T> {
  return {
    success: true,
    data,
    meta: {
      requestId: requestId || crypto.randomUUID(),
      timestamp: new Date().toISOString()
    }
  }
}

/**
 * Creates a standard MCP error response
 */
export function mcpError(
  code: string,
  message: string,
  requestId?: string
): McpResponse<never> {
  return {
    success: false,
    error: {
      code,
      message
    },
    meta: {
      requestId: requestId || crypto.randomUUID(),
      timestamp: new Date().toISOString()
    }
  }
}
