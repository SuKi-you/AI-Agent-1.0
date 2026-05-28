import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import type { Plugin, ViteDevServer } from "vite"

function parseDifyAnswer(answer: string): unknown {
  let text = (answer || "").trim()
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }
  try {
    return JSON.parse(text)
  } catch {
    return { raw_text: answer }
  }
}

function getBody(req: Parameters<Parameters<ViteDevServer["middlewares"]["use"]>[0]>[0]): Promise<string> {
  return new Promise((resolve) => {
    let body = ""
    req.on("data", (chunk: Buffer) => { body += chunk.toString() })
    req.on("end", () => resolve(body))
  })
}

function difyProxyPlugin(): Plugin {
  return {
    name: "dify-proxy",
    configureServer(server) {
      const env = loadEnv("", path.resolve(process.cwd()), "")

      const difyBaseUrl = env.DIFY_API_BASE_URL || "http://localhost/v1"
      const intentApiKey = env.DIFY_INTENT_API_KEY
      const analysisApiKey = env.DIFY_ANALYSIS_API_KEY

      if (!intentApiKey || !analysisApiKey) {
        console.warn("[dify-proxy] ⚠️  DIFY_API keys missing in .env")
      }

      const handleRequest = async (req: any, res: any, apiKey: string | undefined, extraInputs?: Record<string, string>) => {
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type")

        if (req.method === "OPTIONS") {
          res.statusCode = 200
          res.end()
          return
        }

        if (!apiKey) {
          res.statusCode = 500
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "缺少 API Key，请在 .env 中配置" }))
          return
        }

        try {
          const rawBody = await getBody(req)
          const parsed = JSON.parse(rawBody || "{}")
          const query: string = typeof parsed.query === "string" ? parsed.query : String(parsed.query || "")
          // 兼容两种格式：顶层 confirmed_claims（旧）或 inputs.confirmed_claims（新）
          const confirmed_claims = parsed.confirmed_claims || (parsed.inputs && parsed.inputs.confirmed_claims)
          const user = parsed.user || "demo-user"

          console.log("[dify-proxy] parsed query:", String(query).slice(0, 200))
          console.log("[dify-proxy] parsed confirmed_claims:", confirmed_claims)

          if (!query) {
            res.statusCode = 400
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "query 不能为空" }))
            return
          }

          const inputs: Record<string, string> = {}
          if (extraInputs) {
            Object.assign(inputs, extraInputs)
          }

          if (typeof confirmed_claims === "string" && confirmed_claims.trim()) {
            inputs.confirmed_claims = confirmed_claims.trim()
          } else if (Array.isArray(confirmed_claims)) {
            inputs.confirmed_claims = confirmed_claims.join("、")
          }

          const difyBody: Record<string, unknown> = {
            inputs,
            query,
            response_mode: "blocking",
            user,
          }

          const difyUrl = `${difyBaseUrl}/chat-messages`
          console.log(`[dify-proxy] → ${difyUrl}`)
          console.log(`[dify-proxy] dify request body:`, JSON.stringify(difyBody))

          const response = await fetch(difyUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(difyBody),
          })

          if (!response.ok) {
            const errorText = await response.text()
            console.error(`[dify-proxy] Dify error: status=${response.status}, body=${errorText}`)
            console.error(`[dify-proxy] request that caused error:`, JSON.stringify(difyBody))
            res.statusCode = response.status
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: `Dify API 返回错误 (${response.status})`, detail: errorText }))
            return
          }

          const data = await response.json()
          console.log("[dify-proxy] === Dify Raw Response ===")
          console.log("[dify-proxy] full data keys:", Object.keys(data))
          console.log("[dify-proxy] data.answer type:", typeof data.answer, "preview:", String(data.answer || "").slice(0, 500))
          console.log("[dify-proxy] data.data?.outputs:", JSON.stringify(data.data?.outputs || "N/A").slice(0, 300))
          console.log("[dify-proxy] data.outputs:", JSON.stringify(data.outputs || "N/A").slice(0, 300))

          // Dify 多种返回格式：answer / outputs / data.outputs / data.outputs.structured_output
          let rawAnswer = ""
          if (data.answer) {
            rawAnswer = data.answer
          } else if (data.data?.outputs?.structured_output) {
            rawAnswer = JSON.stringify(data.data.outputs.structured_output)
          } else if (data.data?.outputs) {
            rawAnswer = JSON.stringify(data.data.outputs)
          } else if (data.outputs) {
            rawAnswer = JSON.stringify(data.outputs)
          }
          console.log("[dify-proxy] extracted rawAnswer type:", typeof rawAnswer, "length:", rawAnswer.length, "preview:", rawAnswer.slice(0, 500))
          const parsedAnswer = parseDifyAnswer(rawAnswer)
          console.log("[dify-proxy] parsed keys:", Object.keys(parsedAnswer as object))
          console.log("[dify-proxy] === End Dify Response ===")

          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            result: parsedAnswer,
            conversation_id: data.conversation_id,
          }))
        } catch (err) {
          console.error("[dify-proxy] internal error:", err)
          res.statusCode = 500
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "代理服务器内部错误", detail: String(err) }))
        }
      }

      server.middlewares.use("/api/intent", (req, res) => {
        console.log("[dify-proxy] /api/intent ← frontend called Intent Discovery App")
        handleRequest(req, res, intentApiKey)
      })

      server.middlewares.use("/api/analysis", (req, res) => {
        console.log("[dify-proxy] /api/analysis ← frontend called Analysis/Evidence App")
        handleRequest(req, res, analysisApiKey)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), difyProxyPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
