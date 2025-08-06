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

// ---------------- Helper: download image as Base64 ----------------
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
    if (!image_url) return res.status(400).json({ error: "No image_url provided" });

    const base64Image = await downloadImageAsBase64(image_url);
    if (!base64Image) return res.status(400).json({ error: "Failed to download image" });

    const prompt = `
      You are a fashion tagging assistant for ClosetMind.

      Classify clothing items into these categories:
      Generate a "name" field with 3–4 descriptive words (no brands).

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
    if (!wardrobe || !context) return res.status(400).json({ error: "Missing wardrobe or context" });

    const prompt = `
    You're an AI stylist for ClosetMind. Create a color-coordinated outfit.
    LOCKED ITEMS: ${JSON.stringify(locked_items)}
    RECENTLY USED: ${JSON.stringify(recent_item_ids)}
    CONTEXT: ${context}

    RULES:
    - Exactly 1 top, 1 bottom, 1 shoes (unless onepiece)
    - If using "onepiece", skip top & bottom, only include shoes + optional layer/outerwear/accessory
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
    if (responseText.startsWith("```json")) responseText = responseText.replace(/```json|```/g, "").trim();

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error("🧨 JSON Parse Error:", e);
      return res.status(500).json({ error: "Invalid GPT output format", raw: responseText });
    }

    const lockedOutput = locked_items.map((id) => ({ id, reason: "Locked" }));
    res.json({ outfit: [...lockedOutput, ...result.outfit] });
  } catch (err) {
    console.error("💥 Error in /generate-outfit:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- /generate-multistep-outfit --------------------
app.post("/generate-multistep-outfit", async (req, res) => {
  console.log("\n=== [MULTISTEP OUTFIT] ===");
  const { context, vibe, season, temperature, wardrobe } = req.body;
  if (!wardrobe) return res.status(400).json({ error: "Missing wardrobe" });

  async function selectItem(category, previous) {
    const items = wardrobe.filter((i) => i.main_category === category);
    if (!items.length) return null;

    const prompt = `
You're an AI stylist. Select the best ${category}.
CONTEXT:
- Vibe: ${vibe}
- Event: ${context}
- Season: ${season}
- Temperature: ${temperature}°F

ALREADY SELECTED: ${JSON.stringify(previous, null, 2)}

OPTIONS: ${JSON.stringify(items, null, 2)}

RESPONSE FORMAT:
{ "id": "<item_id>", "reason": "..." }
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });

    let text = completion.choices[0].message.content.trim();
    if (text.startsWith("```json")) text = text.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(text);
    } catch {
      console.error(`❌ Failed to parse ${category} step:`, text);
      return null;
    }
  }

  const steps = {};
  steps.top = await selectItem("top", steps);
  steps.bottom = await selectItem("bottom", steps);
  steps.shoes = await selectItem("shoes", steps);

  const accessory = await selectItem("accessory", steps);
  if (accessory) steps.accessory = accessory;

  const outerwear = await selectItem("outerwear", steps);
  if (outerwear) steps.outerwear = outerwear;

  res.json({ steps });
});

// -------------------- /style-single-item --------------------
app.post("/style-single-item", async (req, res) => {
  console.log("\n=== [STYLE SINGLE ITEM] ===");
  const { context, vibe, season, temperature, wardrobe, locked_item } = req.body;
  if (!wardrobe || !locked_item) return res.status(400).json({ error: "Missing wardrobe or locked_item" });

  const filtered = wardrobe.filter((i) => i.id !== locked_item.id);

  const prompt = `
You're an AI stylist. Build outfit around this locked item:
LOCKED ITEM: ${JSON.stringify(locked_item)}
Do NOT replace or duplicate it.

CONTEXT:
- Context: ${context}
- Vibe: ${vibe}
- Season: ${season}
- Temperature: ${temperature}°F

WARDROBE: ${JSON.stringify(filtered)}

RULES:
- No other item from same category as locked_item
- Output strict JSON: { "outfit": [ { "id": "<item_id>", "reason": "..." } ] }
  `;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.6,
    messages: [{ role: "user", content: prompt }],
  });

  let text = completion.choices[0].message.content.trim();
  if (text.startsWith("```json")) text = text.replace(/```json|```/g, "").trim();

  let result;
  try {
    result = JSON.parse(text);
  } catch (e) {
    console.error("🧨 JSON parse error:", e);
    return res.status(500).json({ error: "Invalid GPT output format", raw: text });
  }

  res.json({ outfit: [{ id: locked_item.id, reason: "Locked" }, ...result.outfit] });
});

// -------------------- /generate-outfit-name --------------------
app.post("/generate-outfit-name", async (req, res) => {
  console.log("\n=== [OUTFIT NAME] ===");
  const { vibe, context, season, temperature, items } = req.body;
  if (!vibe || !context || !items) return res.status(400).json({ error: "Missing fields" });

  const prompt = `
Create a short, stylish outfit name (3–6 words) based on:
Vibe: ${vibe}
Context: ${context}
Season: ${season}
Temperature: ${temperature}°F
Clothing items: ${items.join(", ")}
Only return the name.
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });
    res.json({ name: completion.choices[0].message.content.trim() });
  } catch (e) {
    console.error("🔥 GPT outfit name error:", e);
    res.status(500).json({ error: "Failed to generate outfit name" });
  }
});

// -------------------- Start server --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
