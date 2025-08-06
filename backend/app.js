// backend/index.js
import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(bodyParser.json({ limit: "50mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: download image as Base64
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

// -------------------- /tag --------------------
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
      Generate a "name" field that gives a short, human-readable label for the item, no more than 3-4 words.
      Avoid brand names, focus on visible features (color, fit, material, cut).

      Categories:
      - "top"
      - "bottom"
      - "shoes"
      - "outerwear"
      - "accessory"
      - "layer"
      - "onepiece"

      Return raw JSON:
      {
        "name": "",
        "main_category": "...",
        "type": "",
        "primary_color": "",
        "secondary_colors": [],
        "pattern_description": "",
        "vibe_tags": [],
        "season": "spring/summer/fall/winter/all"
      }
    `;

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: base64Image, detail: "low" },
          ],
        },
      ],
    });

    let raw = completion.output_text.trim();
    console.log("📡 Raw GPT Output:", raw);

    raw = raw.replace(/^```json\s*|```$/g, "").trim();

    let tags;
    try {
      tags = JSON.parse(raw);
    } catch (e) {
      console.error("🧨 JSON Parse Error in /tag:", e);
      return res.status(500).json({ error: "Failed to parse GPT output", raw });
    }

    res.json(tags);
  } catch (err) {
    console.error("💥 Error in /tag:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- /generate-outfit --------------------
app.post("/generate-outfit", async (req, res) => {
  console.log("\n=== [GENERATE-OUTFIT ENDPOINT CALLED] ===");
  try {
    const { context, wardrobe, recent_item_ids = [], locked_items = [] } = req.body;

    if (!wardrobe || !context) {
      return res.status(400).json({ error: "Missing wardrobe or context" });
    }

    const prompt = `
    You're an AI stylist for ClosetMind. Create a color-coordinated outfit for this context:
    LOCKED ITEMS: ${JSON.stringify(locked_items)}
    RECENTLY USED: ${JSON.stringify(recent_item_ids)}
    CONTEXT: ${context}
    RULES:
    - Exactly 1 top, 1 bottom, 1 shoes (unless onepiece)
    - Use only wardrobe items
    RESPONSE FORMAT:
    { "outfit": [ { "id": "<item_id>", "reason": "..." } ] }
    WARDROBE: ${JSON.stringify(wardrobe)}
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });

    let responseText = completion.choices[0].message.content.trim();
    console.log("📡 Raw GPT Output:", responseText);

    if (responseText.startsWith("```json")) {
      responseText = responseText.replace(/```json|```/g, "").trim();
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error("🧨 JSON Parse Error in /generate-outfit:", e);
      return res.status(500).json({ error: "Invalid GPT output format", raw: responseText });
    }

    const lockedOutput = locked_items.map((id) => ({ id, reason: "Locked" }));
    const combinedOutfit = [...lockedOutput, ...result.outfit];

    res.json({ outfit: combinedOutfit });
  } catch (err) {
    console.error("💥 Error in /generate-outfit:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- Other endpoints (multi-step, style-single-item, generate-outfit-name) --------------------
// I can fully port these as well — same approach, exact Flask logic, JSON parsing, debug logs

// TODO: port /generate-multistep-outfit
// TODO: port /style-single-item
// TODO: port /generate-outfit-name

// -------------------- Start server --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
