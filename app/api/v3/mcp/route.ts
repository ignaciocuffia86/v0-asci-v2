import { NextResponse } from "next/server"

/**
 * MCP Server Manifest
 * Describes the available tools and capabilities
 */
export async function GET() {
  const manifest = {
    name: "ASCI Sales Intelligence",
    version: "1.0.0",
    description: "B2B sales intelligence platform - access company signals, decision makers, and prospecting tools",
    
    authentication: {
      type: "bearer",
      description: "Use your API key as Bearer token in the Authorization header"
    },
    
    tools: [
      {
        name: "list_campaigns",
        description: "List all campaigns in the workspace",
        endpoint: "/api/v3/mcp/tools/list-campaigns",
        method: "GET",
        parameters: []
      },
      {
        name: "list_accounts",
        description: "List accounts in a specific campaign",
        endpoint: "/api/v3/mcp/tools/list-accounts",
        method: "GET",
        parameters: [
          {
            name: "campaign_id",
            type: "string",
            required: true,
            description: "The campaign UUID"
          }
        ]
      },
      {
        name: "get_account_digest",
        description: "Get the full digest for an account including news, technologies, and contacts",
        endpoint: "/api/v3/mcp/tools/get-account-digest",
        method: "GET",
        parameters: [
          {
            name: "campaign_account_id",
            type: "string",
            required: true,
            description: "The campaign account UUID"
          }
        ]
      },
      {
        name: "get_signals",
        description: "Get signals detected for a company",
        endpoint: "/api/v3/mcp/tools/get-signals",
        method: "GET",
        parameters: [
          {
            name: "company_id",
            type: "string",
            required: true,
            description: "The company UUID"
          }
        ]
      },
      {
        name: "get_contacts",
        description: "Get decision maker contacts for a company",
        endpoint: "/api/v3/mcp/tools/get-contacts",
        method: "GET",
        parameters: [
          {
            name: "company_id",
            type: "string",
            required: true,
            description: "The company UUID"
          }
        ]
      },
      {
        name: "search_companies",
        description: "Search for companies by name or domain",
        endpoint: "/api/v3/mcp/tools/search-companies",
        method: "POST",
        parameters: [
          {
            name: "query",
            type: "string",
            required: true,
            description: "Search query (company name or domain)"
          },
          {
            name: "limit",
            type: "number",
            required: false,
            default: 10,
            description: "Maximum results to return"
          }
        ]
      },
      {
        name: "run_tech_radar",
        description: "Execute Tech Radar analysis for a company to find news and technology implementations",
        endpoint: "/api/v3/mcp/tools/run-tech-radar",
        method: "POST",
        parameters: [
          {
            name: "campaign_account_id",
            type: "string",
            required: true,
            description: "The campaign account UUID"
          }
        ]
      },
      {
        name: "search_decision_makers",
        description: "Search for decision makers at a company using Apollo",
        endpoint: "/api/v3/mcp/tools/search-decision-makers",
        method: "POST",
        parameters: [
          {
            name: "campaign_account_id",
            type: "string",
            required: true,
            description: "The campaign account UUID"
          },
          {
            name: "job_titles",
            type: "string[]",
            required: true,
            description: "Job titles to search for (e.g. ['CTO', 'VP Engineering'])"
          }
        ]
      },
      {
        name: "get_recommended_job_titles",
        description: "Get recommended job titles for a company based on signals and workspace profile",
        endpoint: "/api/v3/mcp/tools/get-recommended-job-titles",
        method: "GET",
        parameters: [
          {
            name: "campaign_account_id",
            type: "string",
            required: true,
            description: "The campaign account UUID"
          }
        ]
      }
    ],
    
    rate_limits: {
      requests_per_minute: 60,
      description: "Default rate limit. Contact support for higher limits."
    }
  }
  
  return NextResponse.json(manifest)
}
