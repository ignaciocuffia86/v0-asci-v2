const API_KEY = process.env.APOLLO_API_KEY

async function testPhoneReveal() {
  if (!API_KEY) { console.log("No APOLLO_API_KEY"); return }

  // Use a known enriched person's ID from the recent search
  // First, search for 1 person
  const searchRes = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": API_KEY },
    body: JSON.stringify({
      q_organization_domains: "naranjax.com",
      person_titles: ["CTO"],
      per_page: 1,
      page: 1,
    }),
  })
  const searchData = await searchRes.json()
  if (!searchData.people?.[0]) { console.log("No search results"); return }
  
  const personId = searchData.people[0].id
  console.log("Person ID:", personId, "Name:", searchData.people[0].first_name)

  // Enrich with reveal_phone_number
  const enrichRes = await fetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      id: personId,
      reveal_personal_emails: true,
      reveal_phone_number: true,
    }),
  })
  
  console.log("Enrich status:", enrichRes.status)
  const enrichData = await enrichRes.json()
  
  if (enrichData.person) {
    const p = enrichData.person
    console.log("\n=== ENRICHED PERSON ===")
    console.log("name:", p.name)
    console.log("email:", p.email)
    console.log("email_status:", p.email_status)
    console.log("linkedin_url:", p.linkedin_url)
    console.log("phone_numbers:", JSON.stringify(p.phone_numbers))
    console.log("sanitized_phone:", p.sanitized_phone)
    console.log("corporate_phone:", p.corporate_phone)
    console.log("personal_emails:", p.personal_emails)
    console.log("organization:", p.organization?.name)
    console.log("seniority:", p.seniority)
    
    // Log ALL top-level keys that have non-null values
    const nonNullKeys = Object.keys(p).filter(k => p[k] !== null && p[k] !== undefined && p[k] !== "")
    console.log("\nNon-null keys:", nonNullKeys.join(", "))
  } else {
    console.log("No person in response. Keys:", Object.keys(enrichData))
    console.log("Full response:", JSON.stringify(enrichData).slice(0, 500))
  }
}

testPhoneReveal().catch(console.error)
