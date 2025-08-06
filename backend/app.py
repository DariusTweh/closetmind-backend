from flask import Flask, request, jsonify
from openai import OpenAI
import requests
import json
import base64
import os
import re
import traceback

app = Flask(__name__)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

def download_image_as_base64(image_url):
    print(f"🔍 [download_image_as_base64] Downloading: {image_url}")
    response = requests.get(image_url)
    print(f"   ➡️ Status Code: {response.status_code}")
    if response.status_code != 200:
        return None
    encoded = base64.b64encode(response.content).decode("utf-8")
    print("   ✅ Image downloaded and encoded.")
    return f"data:image/jpeg;base64,{encoded}"

@app.route("/tag", methods=["POST"])
def tag_clothing():
    print("\n=== [TAG ENDPOINT CALLED] ===")
    try:
        data = request.get_json(force=True)
        print(f"📦 Incoming Data: {data}")

        image_url = data.get("image_url")
        if not image_url:
            print("❌ No image_url provided")
            return jsonify({"error": "No image_url provided"}), 400

        base64_image = download_image_as_base64(image_url)
        if not base64_image:
            print("❌ Failed to download/encode image")
            return jsonify({"error": "Failed to download image"}), 400

        prompt = """
        You are a fashion tagging assistant for ClosetMind.
        Classify clothing items...
        """

        print("🛠 Sending request to OpenAI for tagging...")
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": base64_image, "detail": "low"}
                ],
            }],
            response_format={"type": "json_object"}
        )

        print(f"📡 Raw OpenAI Response: {response}")
        raw_text = getattr(response, "output_text", "").strip()
        print(f"📝 Parsed output_text: {raw_text}")

        if not raw_text:
            print("❌ No text output from GPT")
            return jsonify({"error": "No output from GPT", "raw": str(response)}), 500

        # Clean code fences
        raw_text = re.sub(r"^```[a-zA-Z]*\n?", "", raw_text)
        raw_text = re.sub(r"```$", "", raw_text)

        tags = json.loads(raw_text)
        print(f"✅ Final Tags: {tags}")
        return jsonify(tags)

    except json.JSONDecodeError as e:
        print(f"❌ JSON Decode Error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to parse GPT response", "raw": raw_text}), 500
    except Exception as e:
        print(f"💥 Unexpected Error in /tag: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/generate-outfit', methods=['POST'])
def generate_outfit():
    print("\n=== [GENERATE-OUTFIT ENDPOINT CALLED] ===")
    try:
        data = request.get_json(force=True)
        print(f"📦 Incoming Data: {json.dumps(data, indent=2)}")

        context = data.get('context', '')
        wardrobe = data.get('wardrobe', [])

        if not wardrobe or not context:
            print("❌ Missing wardrobe or context")
            return jsonify({"error": "Missing wardrobe or context"}), 400

        print("🛠 Sending request to OpenAI for outfit generation...")
        completion = client.chat.completions.create(
            model="gpt-4.1-mini",
            temperature=0.5,
            messages=[
                {
                    "role": "user",
                    "content": f"""
                    You're an AI stylist...
                    WARDROBE:
                    {wardrobe}
                    """
                }
            ]
        )

        response_text = completion.choices[0].message.content.strip()
        print(f"📡 Raw GPT Output: {response_text}")

        result = json.loads(response_text)
        print(f"✅ Final Parsed Outfit: {result}")
        return jsonify(result)

    except json.JSONDecodeError as e:
        print(f"❌ JSON Decode Error in /generate-outfit: {e}")
        traceback.print_exc()
        return jsonify({"error": "Invalid GPT output format", "raw": response_text}), 500
    except Exception as e:
        print(f"💥 Unexpected Error in /generate-outfit: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print("🚀 Backend starting on port 5000...")
    app.run(debug=True, host="0.0.0.0", port=5000)
