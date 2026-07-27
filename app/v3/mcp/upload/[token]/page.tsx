import { UploadForm } from "./upload-form"

export default async function McpUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><UploadForm token={token} /></main>
}
