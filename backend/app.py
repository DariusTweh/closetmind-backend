from flask import Flask, request, jsonify
from openai import OpenAI
import requests
import json
import base64
import os

app = Flask(__name__)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))  # Replace with your real key

def download_image_as_base64(image_url):
    response = requests.get(image_url)
    if response.status_code != 200:
        return None
    encoded = base64.b64encode(response.content).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"

@app.route("/tag", methods=["POST"])
def tag_clothing():
    data = request.get_json()
    image_url = data.get("image_url")
    if not image_url:
        return jsonify({"error": "No image_url provided"}), 400

    base64_image = download_image_as_base64(image_url)
    if not base64_image:
        return jsonify({"error": "Failed to download image"}), 400

    prompt = (
                """
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
                """
    )

    response = client.responses.create(
        model="gpt-4.1-mini",
        input=[{
            "role": "user",
            "content": [
                { "type": "input_text", "text": prompt },
                { "type": "input_image", "image_url": base64_image, "detail": "low" }
            ],
        }],
    )

    return jsonify(eval(response.output_text))  # eval assumes GPT returns raw JSON



@app.route('/generate-outfit', methods=['POST'])
def generate_outfit():
    data = request.json
    context = data.get('context', '')
    wardrobe = data.get('wardrobe', [])
    
    
    if not wardrobe or not context:
        return jsonify({ "error": "Missing wardrobe or context" }), 400


    completion = client.chat.completions.create(
        model="gpt-4.1-mini",  # or "gpt-4o"
        temperature=0.5,
        messages=[
            {
                "role": "user",
                
                "content": f"""
    You're an AI stylist for ClosetMind. Create a color-coordinated outfit for this context:
    GOAL:
Curate an outfit that looks intentional, expressive of the vibe, season-appropriate, and color-coordinated. Avoid repeating obvious or generic combinations. Prioritize style, balance, and variety.

RECENTLY USED ITEMS (if possible, avoid these unless necessary):


    CONTEXT:
{context}
   INSTRUCTIONS:
- Choose pieces that work together in color, texture, or silhouette.
- Provide a **1-sentence reason** for each item explaining its role in the outfit.
- Avoid reusing exact phrasing in explanations.
- Focus on quality — not randomness.

RULES:
- Include exactly 1 top, 1 bottom, and 1 pair of shoes, unless using a onepiece.
- If using a `"onepiece"` (like a dress or jumpsuit), skip top and bottom, and only include shoes (and optionally a layer, outerwear, or accessory).
- If including a `"layer"` (hoodie, sweater, cardigan), you must also include a `"top"` — never use a layer alone.
- Do not use outerwear or layers as a substitute for tops.
- Optionally include 1 outerwear and/or 1 accessory, but only if it complements the look.
- Favor combinations that feel fresh or visually interesting.
- Only use items from the wardrobe.
- Respond ONLY with raw JSON — no text, no intro, no formatting, no commentary:
RESPONSE FORMAT (strict):
{{
  "outfit": [
    {{ "id": "<item_id>", "reason": "..." }},
    ...
  ]
}}



WARDROBE:
{wardrobe}
                """
            }
        ]
    )

    response_text = completion.choices[0].message.content.strip()
    errorss= ""

    try:
        result = json.loads(response_text)
        errorss=result  # ✅ safer than eval
    except json.JSONDecodeError as e:
        print("🧨 JSON parse error:", e)
     

        return jsonify({ "error": "Invalid GPT output format", "raw": response_text }), 500

    return jsonify(result)



if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
