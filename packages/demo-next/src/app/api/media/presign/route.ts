import { NextRequest, NextResponse } from 'next/server'

// Demo-only presign: generate a fake presigned URL that just echoes content.
// Replace with real S3/R2/MinIO presign using server-side SDK in production.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || !body.key || !body.contentType) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  // For demo, simulate presign by pointing to a data URL fallback; in
  // a real setup this should return a PUT-able URL to object storage
  const url = `https://example.invalid/upload/${encodeURIComponent(body.key)}?contentType=${encodeURIComponent(body.contentType)}`
  return NextResponse.json({ url })
}


