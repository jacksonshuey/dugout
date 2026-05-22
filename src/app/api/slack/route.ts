import { NextResponse } from "next/server";
import { postToSlack, signalsToSlackPayload } from "@/lib/slack";
import { requireUiSession } from "@/lib/ui-auth-server";

interface SlackRequest {
  repName: string;
  digest: string;
}

export async function POST(req: Request) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  let body: SlackRequest;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Body must be a JSON object" },
        { status: 400 },
      );
    }
    body = parsed as SlackRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.repName || !body.digest) {
    return NextResponse.json(
      { error: "Missing repName or digest" },
      { status: 400 },
    );
  }

  const payload = signalsToSlackPayload(body.repName, body.digest);
  const result = await postToSlack(payload);

  return NextResponse.json(result);
}
