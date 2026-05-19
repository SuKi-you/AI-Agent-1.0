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
    const { query, user = "demo-user" } = await req.json();
    const difyIntentApiKey = Deno.env.get("DIFY_INTENT_API_KEY");

    if (!difyIntentApiKey) {
      console.error("DIFY_INTENT_API_KEY is not set");
      return new Response(
        JSON.stringify({
          error: "缺少 DIFY_INTENT_API_KEY，请在 Secrets 中配置 Intent Discovery App 的 API Key",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const response = await fetch("https://api.dify.ai/v1/chat-messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${difyIntentApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {},
        query,
        response_mode: "blocking",
        user,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Dify intent API error: status=${response.status}, body=${errorText}`);
      return new Response(
        JSON.stringify({
          error: `Dify Intent API 返回错误 (${response.status})`,
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
      let answerText = data.answer || "";
      // Strip markdown code block wrappers: ```json ... ``` or ``` ... ```
      answerText = answerText.trim();
      if (answerText.startsWith("```")) {
        answerText = answerText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      parsedAnswer = JSON.parse(answerText);
    } catch {
      console.error("Failed to parse Dify answer as JSON, returning raw text:", data.answer);
      parsedAnswer = { raw_text: data.answer };
    }

    return new Response(
      JSON.stringify({
        result: parsedAnswer,
        conversation_id: data.conversation_id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("dify-intent function error:", error);
    return new Response(
      JSON.stringify({
        error: "Edge Function 内部错误",
        detail: String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
