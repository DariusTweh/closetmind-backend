from flask import Flask, request, jsonify
from openai import OpenAI
import requests
import json
import base64
import os
import re

app = Flask(__name__)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

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

    prompt = """
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

    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": base64_image, "detail": "low"}
                ],
            }],
            response_format={"type": "json_object"}  # Force JSON output
        )

        raw_text = getattr(response, "output_text", "").strip()
        if not raw_text:
            return jsonify({"error": "No output from GPT", "raw": str(response)}), 500

        # Remove potential code fences if present
        raw_text = re.sub(r"^```[a-zA-Z]*\n?", "", raw_text)
        raw_text = re.sub(r"```$", "", raw_text)

        tags = json.loads(raw_text)
        return jsonify(tags)

    except json.JSONDecodeError as e:
        return jsonify({"error": "Failed to parse GPT response", "raw": raw_text}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/generate-outfit', methods=['POST'])
def generate_outfit():
    data = request.json
    context = data.get('context', '')
    wardrobe = data.get('wardrobe', [])

    if not wardrobe or not context:
        return jsonify({"error": "Missing wardrobe or context"}), 400

    completion = client.chat.completions.create(
        model="gpt-4.1-mini",
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
- If using a `"onepiece"`, skip top and bottom, and only include shoes (and optionally a layer, outerwear, or accessory).
- If including a `"layer"`, you must also include a `"top"`.
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
    try:
        result = json.loads(response_text)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid GPT output format", "raw": response_text}), 500

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
