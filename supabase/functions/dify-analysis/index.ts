import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { query, confirmed_claims, user = "demo-user" } = await req.json();
    const claimsStr = Array.isArray(confirmed_claims)
      ? confirmed_claims.join("、")
      : confirmed_claims;
    const difyAnalysisApiKey = Deno.env.get("DIFY_ANALYSIS_API_KEY");

    if (!difyAnalysisApiKey) {
      return new Response(
        JSON.stringify({ error: "DIFY_ANALYSIS_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const response = await fetch("https://api.dify.ai/v1/chat-messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${difyAnalysisApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {
          confirmed_claims: claimsStr,
        },
        query,
        response_mode: "blocking",
        user,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({
          error: "Analysis/Evidence API 调用失败",
          detail: errorText,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();

    let parsedAnswer;
    try {
      parsedAnswer = JSON.parse(data.answer);
    } catch {
      parsedAnswer = data.answer;
    }

    return new Response(
      JSON.stringify({
        raw: data,
        result: parsedAnswer,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "服务器错误",
        detail: String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
