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
    const { message, conversation_id } = await req.json();
    const difyApiKey = Deno.env.get("DIFY_API_KEY");

    if (!difyApiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "DIFY_API_KEY not configured",
          fallback: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const difyResponse = await fetch(
      "https://api.dify.ai/v1/chat-messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${difyApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: {},
          query: message,
          response_mode: "blocking",
          conversation_id: conversation_id || "",
          user: "anonymous",
        }),
      }
    );

    if (!difyResponse.ok) {
      const errorText = await difyResponse.text();
      return new Response(
        JSON.stringify({
          success: false,
          error: `Dify API error: ${difyResponse.status}`,
          details: errorText,
          fallback: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await difyResponse.json();

    return new Response(
      JSON.stringify({
        success: true,
        answer: data.answer,
        conversation_id: data.conversation_id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        fallback: true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
