import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.json({ limit: "50mb" }));

async function downloadImageAsBase64(imageUrl) {
  console.log(`🔍 Downloading image: ${imageUrl}`);
  const res = await fetch(imageUrl);
  if (!res.ok) {
    console.error("❌ Failed to fetch image:", res.status);
    return null;
  }
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  console.log("✅ Image downloaded and encoded");
  return `data:image/jpeg;base64,${base64}`;
}

app.post("/tag", async (req, res) => {
  console.log("\n=== [TAG ENDPOINT CALLED] ===");
  try {
    const { image_url } = req.body;
    if (!image_url) {
      return res.status(400).json({ error: "No image_url provided" });
    }

    const base64Image = await downloadImageAsBase64(image_url);
    if (!base64Image) {
      return res.status(400).json({ error: "Failed to download image" });
    }

    const prompt = `
      You are a fashion tagging assistant for ClosetMind.
      Classify clothing items into these categories:
      - "top": shirts, blouses, tanks, crop tops, etc.
      - "bottom": pants, jeans, shorts, skirts, etc.
      - "shoes": sneakers, boots, heels, etc.
      - "outerwear": jackets and coats
      - "accessory": hats, bags, scarves, jewelry
      - "layer": sweaters, hoodies, cardigans — items worn over tops but under jackets
      - "onepiece": dresses, jumpsuits, rompers — full-body garments that combine top and bottom
      Return raw JSON in this format:
      {
        "main_category": one of ["top", "bottom", "shoes", "outerwear", "accessory", "layer", "onepiece"],
        "type": string,
        "primary_color": string,
        "secondary_colors": [string],
        "pattern_description": string,
        "vibe_tags": [string],
        "season": one of ["spring", "summer", "fall", "winter", "all"]
      }
    `;

    console.log("🛠 Sending request to OpenAI...");
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: base64Image, detail: "low" } },
          ],
        },
      ],
    });

    const rawText = completion.choices[0].message.content.trim();
    console.log("📝 Parsed output_text:", rawText);

    const tags = JSON.parse(rawText);
    console.log("✅ Final Tags:", tags);

    res.json(tags);
  } catch (err) {
    console.error("💥 Error in /tag:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate-outfit", async (req, res) => {
  console.log("\n=== [GENERATE-OUTFIT ENDPOINT CALLED] ===");
  try {
    const { context, wardrobe } = req.body;

    if (!wardrobe || !context) {
      return res.status(400).json({ error: "Missing wardrobe or context" });
    }

    const prompt = `
      You're an AI stylist for ClosetMind. Create a color-coordinated outfit for this context:
      GOAL:
      Curate an outfit that looks intentional, expressive of the vibe, season-appropriate, and color-coordinated.
      Avoid repeating obvious or generic combinations. Prioritize style, balance, and variety.

      CONTEXT:
      ${context}

      INSTRUCTIONS:
      - Choose pieces that work together in color, texture, or silhouette.
      - Provide a **1-sentence reason** for each item explaining its role in the outfit.
      - Avoid reusing exact phrasing in explanations.
      - Focus on quality — not randomness.

      RULES:
      - Include exactly 1 top, 1 bottom, and 1 pair of shoes, unless using a onepiece.
      - If using a "onepiece", skip top and bottom, and only include shoes (and optionally a layer, outerwear, or accessory).
      - If including a "layer", you must also include a "top".
      - Do not use outerwear or layers as a substitute for tops.
      - Optionally include 1 outerwear and/or 1 accessory, but only if it complements the look.
      - Favor combinations that feel fresh or visually interesting.
      - Only use items from the wardrobe.
      - Respond ONLY with raw JSON — no text, no intro, no formatting, no commentary:
      RESPONSE FORMAT (strict):
      {
        "outfit": [
          { "id": "<item_id>", "reason": "..." },
          ...
        ]
      }

      WARDROBE:
      ${JSON.stringify(wardrobe)}
    `;

    console.log("🛠 Sending request to OpenAI...");
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log("📡 Raw GPT Output:", responseText);

    try {
      const result = JSON.parse(responseText);
      console.log("✅ Final Parsed Outfit:", result);
      res.json(result);
    } catch (e) {
      console.error("🧨 JSON parse error:", e);
      res.status(500).json({ error: "Invalid GPT output format", raw: responseText });
    }
  } catch (err) {
    console.error("💥 Error in /generate-outfit:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
