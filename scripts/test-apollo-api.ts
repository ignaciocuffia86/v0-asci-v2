// Test script to see exactly what Apollo API returns
const API_KEY = process.env.APOLLO_API_KEY

if (!API_KEY) {
  console.error("APOLLO_API_KEY not set")
  process.exit(1)
}

async function testSearch() {
  console.log("=== STEP 1: mixed_people/search ===")
  const searchResponse = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      organization_domains: ["naranjax.com"],
      person_titles: ["CTO", "CIO", "IT Manager"],
      per_page: 3,
    }),
  })

  const searchData = await searchResponse.json()
  console.log("Search status:", searchResponse.status)
  console.log("Search response top-level keys:", Object.keys(searchData))
  console.log("People count:", searchData.people?.length)
  
  if (searchData.people && searchData.people.length > 0) {
    const person = searchData.people[0]
    console.log("\n--- First person from SEARCH ---")
    console.log("Keys:", Object.keys(person).sort().join(", "))
    console.log("id:", person.id)
    console.log("first_name:", person.first_name)
    console.log("last_name:", person.last_name)
    console.log("name:", person.name)
    console.log("title:", person.title)
    console.log("email:", person.email)
    console.log("linkedin_url:", person.linkedin_url)
    console.log("photo_url:", person.photo_url)
    console.log("phone_numbers:", JSON.stringify(person.phone_numbers))
    console.log("seniority:", person.seniority)
    console.log("headline:", person.headline)
    console.log("city:", person.city)
    console.log("country:", person.country)

    // Step 2: Try bulk_match with id
    console.log("\n=== STEP 2: people/bulk_match with IDs ===")
    const ids = searchData.people.slice(0, 3).map((p) => p.id)
    console.log("Person IDs:", ids)

    const matchResponse = await fetch("https://api.apollo.io/api/v1/people/bulk_match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        details: ids.map((id) => ({ id })),
        reveal_personal_emails: true,
        reveal_phone_number: true,
      }),
    })

    const matchData = await matchResponse.json()
    console.log("bulk_match status:", matchResponse.status)
    console.log("bulk_match response top-level keys:", Object.keys(matchData))
    console.log("matches count:", matchData.matches?.length)
    console.log("people count:", matchData.people?.length)
    console.log("status:", matchData.status)

    if (matchData.matches && matchData.matches.length > 0) {
      const match = matchData.matches[0]
      console.log("\n--- First match from BULK_MATCH ---")
      console.log("Type:", typeof match)
      if (typeof match === "object" && match !== null) {
        console.log("Keys:", Object.keys(match).sort().join(", "))
        console.log("id:", match.id)
        console.log("first_name:", match.first_name)
        console.log("last_name:", match.last_name)
        console.log("name:", match.name)
        console.log("email:", match.email)
        console.log("linkedin_url:", match.linkedin_url)
        console.log("photo_url:", match.photo_url)
        console.log("phone_numbers:", JSON.stringify(match.phone_numbers))
        console.log("seniority:", match.seniority)
        console.log("headline:", match.headline)
      } else {
        console.log("Match is not an object:", JSON.stringify(match).slice(0, 300))
      }
    } else {
      console.log("NO matches returned!")
      console.log("Full response (first 500 chars):", JSON.stringify(matchData).slice(0, 500))
    }

    // Step 3: Try single person match endpoint
    console.log("\n=== STEP 3: people/match (single) with ID ===")
    const singleResponse = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        id: ids[0],
        reveal_personal_emails: true,
        reveal_phone_number: true,
      }),
    })

    const singleData = await singleResponse.json()
    console.log("people/match status:", singleResponse.status)
    console.log("Response top-level keys:", Object.keys(singleData))
    if (singleData.person) {
      const p = singleData.person
      console.log("\n--- Person from SINGLE MATCH ---")
      console.log("Keys:", Object.keys(p).sort().join(", "))
      console.log("id:", p.id)
      console.log("first_name:", p.first_name)
      console.log("last_name:", p.last_name)
      console.log("name:", p.name)
      console.log("email:", p.email)
      console.log("linkedin_url:", p.linkedin_url)
      console.log("photo_url:", p.photo_url)
      console.log("phone_numbers:", JSON.stringify(p.phone_numbers))
      console.log("seniority:", p.seniority)
    } else {
      console.log("No person in response:", JSON.stringify(singleData).slice(0, 500))
    }
  }
}

testSearch().catch(console.error)
