import { redirect } from "next/navigation"

export default function AdminIndexPage() {
  redirect("/v3/admin/usage")
}
