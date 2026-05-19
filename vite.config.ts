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
          const { query, confirmed_claims, user = "demo-user" } = JSON.parse(rawBody || "{}")

          const inputs: Record<string, string> = {}
          if (extraInputs) {
            Object.assign(inputs, extraInputs)
          }

          if (Array.isArray(confirmed_claims)) {
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
            res.statusCode = response.status
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: `Dify API 返回错误 (${response.status})`, detail: errorText }))
            return
          }

          const data = await response.json()
          const parsedAnswer = parseDifyAnswer(data.answer)

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
        handleRequest(req, res, intentApiKey)
      })

      server.middlewares.use("/api/analysis", (req, res) => {
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
