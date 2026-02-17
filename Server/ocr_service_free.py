"""
FREE OCR Service - No Credits Needed!
Uses Groq Vision API - sees images directly!

This replaces Landing AI functionality completely for FREE.
~7,000 images/day FREE (resets daily)
"""

import os
import io
import json
import base64
import requests
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image as PILImage
import pypdfium2 as pdfium

# --- Configuration ---


GROQ_API_KEY = os.getenv("GROQ_API_KEY")

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"  # Llama 4 Vision model

# --- FastAPI Setup ---
app = FastAPI(title="Free OCR Service (Groq Vision)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def image_to_base64(image: PILImage.Image) -> str:
    """Convert PIL Image to base64 string"""
    # Resize if too large (Groq limit: 4MB for base64, 33 megapixels)
    max_size = 2048  # Increased for better quality
    if max(image.size) > max_size:
        ratio = max_size / max(image.size)
        new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
        image = image.resize(new_size, PILImage.Resampling.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", quality=95)  # Higher quality
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def pdf_to_images(pdf_bytes: bytes) -> list:
    """Convert PDF pages to PIL Images"""
    images = []
    pdf = pdfium.PdfDocument(pdf_bytes)

    for page_num in range(len(pdf)):
        page = pdf[page_num]
        # Render at 200 DPI for better quality
        bitmap = page.render(scale=200/72)
        pil_image = bitmap.to_pil()
        images.append(pil_image)

    return images


def extract_with_groq(images: list) -> dict:
    """
    Send multiple images to Groq Vision API.
    Groq supports up to 5 images per request - perfect for multi-page PDFs!
    """
    if GROQ_API_KEY == "YOUR_GROQ_API_KEY_HERE":
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY not configured. Get free key from https://console.groq.com/keys"
        )

    # Convert all images to base64
    image_contents = []
    for i, img in enumerate(images):
        image_b64 = image_to_base64(img)
        image_contents.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{image_b64}"
            }
        })

    num_pages = len(images)
    prompt = f"""Look at these {num_pages} page(s) of a quiz/exam document. Extract ALL questions with COMPLETE text.

IMPORTANT: This document may contain BOTH objective (MCQ, True/False, Fill in the Blank) AND subjective (Short Answer, Long Answer, Essay, Descriptive) questions. You MUST handle ALL types.

Questions may span across pages. Combine information from all pages to get complete questions.

Return a JSON object with this EXACT structure:
{{
  "documentInfo": {{
    "enrollmentNumber": "student enrollment number if visible, otherwise '0'",
    "date": "date if visible, otherwise empty string",
    "totalMarks": total marks as number if visible, otherwise 0
  }},
  "questions": [
    {{
      "questionText": "ONLY the question text and code (DO NOT include options here for MCQs)",
      "questionType": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": marks for this question as number (default 1),
      "options": ["A) option1", "B) option2", "C) option3", "D) option4"],
      "Answer": "see rules below for format based on questionType"
    }}
  ]
}}

QUESTION TYPE CLASSIFICATION RULES:
- "MCQ": Question has multiple choice options (A, B, C, D). Answer = letter(s) only e.g. "B" or "A,C"
- "TRUE_FALSE": Question asks True or False. Answer = "True" or "False"
- "FILL_BLANK": Question has blanks to fill. Answer = the word/phrase that fills the blank
- "SHORT": Subjective question expecting 1-3 sentence answer (typically 1-5 marks). Answer = the full written answer text
- "LONG": Subjective question expecting paragraph/essay/detailed answer (typically 5+ marks, or says "explain", "describe", "discuss", "elaborate", "write in detail"). Answer = the full written answer text

CRITICAL RULES:
1. questionText = ONLY the question stem and any code. NEVER include options (A, B, C, D) in questionText
2. For MCQ: options = array with ALL choices separately ["A) ...", "B) ...", "C) ...", "D) ..."]
3. For MCQ: Answer = ONLY letter(s). Single answer: "B". Multiple correct: "A,C"
4. For SHORT/LONG: options = empty array []. Answer = the COMPLETE written answer text as found in the document. If this is an answer key, copy the full model answer. If this is a student response, copy exactly what the student wrote.
5. For TRUE_FALSE: options = ["True", "False"]. Answer = "True" or "False"
6. For FILL_BLANK: options = []. Answer = the word/phrase answer
7. If a question starts on one page and continues on next, COMBINE them
8. For code questions, include the ENTIRE code snippet in questionText
9. Read ALL text carefully from ALL pages
10. Include question numbers like "Q1", "1.", etc. in questionText
11. If answer is marked/circled/ticked, extract it
12. If MULTIPLE answers are marked correct for MCQ, include ALL of them comma-separated
13. Do NOT summarize - extract EXACT text from the images
14. For subjective answers, preserve the FULL text including all points, explanations, and examples
15. Return ONLY valid JSON, no explanation

OBJECTIVE EXAMPLE:
questionText: "Q.1) What is 2+2?"
questionType: "MCQ"
options: ["A) 3", "B) 4", "C) 5", "D) 6"]
Answer: "B"

SUBJECTIVE SHORT EXAMPLE:
questionText: "Q.3) Define polymorphism in OOP."
questionType: "SHORT"
options: []
Answer: "Polymorphism is the ability of an object to take on many forms. In OOP, it allows methods to do different things based on the object that is calling them."

SUBJECTIVE LONG EXAMPLE:
questionText: "Q.5) Explain the different types of sorting algorithms with their time complexities."
questionType: "LONG"
options: []
Answer: "Sorting algorithms can be classified into comparison-based and non-comparison-based... (full detailed answer)"

TRUE/FALSE EXAMPLE:
questionText: "Q.4) A stack follows FIFO principle."
questionType: "TRUE_FALSE"
options: ["True", "False"]
Answer: "False"

WRONG (DO NOT DO THIS):
questionText: "Q.1) What is 2+2? A) 3 B) 4 C) 5 D) 6" (options should NOT be in questionText)"""

    # Build message content with all images + prompt
    content = image_contents + [{"type": "text", "text": prompt}]

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {
                "role": "user",
                "content": content
            }
        ],
        "temperature": 0.1,
        "max_tokens": 8192,
        "response_format": {"type": "json_object"}
    }

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        print(f"Sending {num_pages} image(s) to Groq Vision...")
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=120
        )
        response.raise_for_status()

        result = response.json()
        json_text = result["choices"][0]["message"]["content"]

        # Clean up response
        json_text = json_text.strip()
        if json_text.startswith("```"):
            parts = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        json_text = json_text.strip()

        parsed = json.loads(json_text)

        # Post-process to clean questionText and answers based on question type
        if parsed.get("questions"):
            import re
            for q in parsed["questions"]:
                # Normalize questionType
                qtype = (q.get("questionType") or "MCQ").upper().strip()
                type_mapping = {
                    "MCQ": "MCQ",
                    "MULTIPLE CHOICE": "MCQ",
                    "MULTI CHOICE": "MCQ",
                    "SHORT": "SHORT",
                    "SHORT ANSWER": "SHORT",
                    "LONG": "LONG",
                    "LONG ANSWER": "LONG",
                    "ESSAY": "LONG",
                    "DESCRIPTIVE": "LONG",
                    "TRUE_FALSE": "TRUE_FALSE",
                    "TRUE/FALSE": "TRUE_FALSE",
                    "TRUEFALSE": "TRUE_FALSE",
                    "FILL_BLANK": "FILL_BLANK",
                    "FILL IN THE BLANK": "FILL_BLANK",
                    "FILL": "FILL_BLANK",
                }
                q["questionType"] = type_mapping.get(qtype, qtype)

                if q.get("questionText"):
                    text = q["questionText"]

                    # Only strip options from MCQ/TRUE_FALSE questions
                    if q["questionType"] in ["MCQ", "TRUE_FALSE"]:
                        option_patterns = [
                            r'\s+[Aa]\s*[\)\.\:]',
                            r'\s+\([Aa]\)',
                            r'\n[Aa]\s*[\)\.\:]',
                        ]

                        for pattern in option_patterns:
                            option_start = re.search(pattern, text)
                            if option_start and q.get("options") and len(q["options"]) > 0:
                                q["questionText"] = text[:option_start.start()].strip()
                                break

                # Clean Answer based on question type
                if q.get("Answer"):
                    answer = str(q["Answer"]).strip()

                    if q["questionType"] == "MCQ":
                        # For MCQ: extract only letter(s)
                        letters = re.findall(r'[A-Ea-e]', answer.upper())
                        if letters:
                            seen = set()
                            unique_letters = []
                            for letter in letters:
                                if letter not in seen:
                                    seen.add(letter)
                                    unique_letters.append(letter)
                            q["Answer"] = ",".join(unique_letters)
                        else:
                            q["Answer"] = ""
                    elif q["questionType"] == "TRUE_FALSE":
                        # Normalize to "True" or "False"
                        if answer.lower() in ["true", "t", "yes"]:
                            q["Answer"] = "True"
                        elif answer.lower() in ["false", "f", "no"]:
                            q["Answer"] = "False"
                    # For SHORT, LONG, FILL_BLANK: keep the full text answer as-is

                # Ensure options is an empty array for subjective types
                if q["questionType"] in ["SHORT", "LONG", "FILL_BLANK"]:
                    if not q.get("options") or (len(q.get("options", [])) > 0 and all(not opt.strip() for opt in q["options"])):
                        q["options"] = []

        return parsed

    except requests.exceptions.HTTPError as e:
        error_msg = str(e)
        try:
            error_detail = e.response.json()
            error_msg = error_detail.get("error", {}).get("message", str(e))
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Groq API error: {error_msg}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=500, detail="Groq API timeout")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Groq API failed: {e}")
    except json.JSONDecodeError as e:
        print(f"JSON parse error. Raw response: {json_text[:1000]}")
        raise HTTPException(status_code=500, detail=f"Invalid JSON from Groq: {e}")


def process_file(file_bytes: bytes, filename: str) -> dict:
    """Process image or PDF file with Groq Vision"""
    ext = Path(filename).suffix.lower()

    if ext == '.pdf':
        # Convert PDF to images
        print(f"Processing PDF: {filename}")
        images = pdf_to_images(file_bytes)
        print(f"  Found {len(images)} page(s)")

        # Groq supports up to 5 images per request
        # Send all pages together for better context
        if len(images) <= 5:
            print(f"  Sending all {len(images)} pages together...")
            return extract_with_groq(images)
        else:
            # For PDFs with more than 5 pages, process in batches
            print(f"  PDF has {len(images)} pages, processing in batches of 5...")
            all_questions = []
            doc_info = {"enrollmentNumber": "0", "date": "", "totalMarks": 0}

            for i in range(0, len(images), 5):
                batch = images[i:i+5]
                print(f"  Processing pages {i+1}-{i+len(batch)}...")
                try:
                    result = extract_with_groq(batch)

                    if result.get("documentInfo"):
                        info = result["documentInfo"]
                        if info.get("enrollmentNumber") and info["enrollmentNumber"] != "0":
                            doc_info["enrollmentNumber"] = info["enrollmentNumber"]
                        if info.get("date"):
                            doc_info["date"] = info["date"]
                        if info.get("totalMarks"):
                            doc_info["totalMarks"] = info["totalMarks"]

                    if result.get("questions"):
                        all_questions.extend(result["questions"])

                except Exception as e:
                    print(f"  Error on batch: {e}")
                    continue

            return {
                "documentInfo": doc_info,
                "questions": all_questions
            }

    elif ext in ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp']:
        # Direct image processing (single image as list)
        print(f"Processing image: {filename}")
        image = PILImage.open(io.BytesIO(file_bytes)).convert('RGB')
        return extract_with_groq([image])

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")


# --- API Endpoints ---

@app.post("/ocr/extract")
async def extract_from_file(file: UploadFile = File(...)):
    """
    Extract structured quiz data from uploaded file using Groq Vision.
    Supports: PDF, JPG, PNG, etc.

    Groq sees the image directly - no separate OCR step!
    """
    content = await file.read()

    print(f"\n{'='*50}")
    print(f"Processing: {file.filename}")

    extraction = process_file(content, file.filename)

    print(f"Found {len(extraction.get('questions', []))} questions")
    print(f"{'='*50}\n")

    return JSONResponse(content={
        "success": True,
        "extraction": extraction,
        "filename": file.filename
    })


@app.get("/health")
async def health():
    """Health check"""
    api_configured = GROQ_API_KEY != "YOUR_GROQ_API_KEY_HERE"

    return {
        "status": "healthy" if api_configured else "needs_api_key",
        "groq_api_configured": api_configured,
        "model": GROQ_MODEL,
        "get_key_at": "https://console.groq.com/keys" if not api_configured else None
    }


# --- For direct testing ---
if __name__ == "__main__":
    import uvicorn
    import sys

    if len(sys.argv) > 1:
        # Test with a file
        test_file = sys.argv[1]
        print(f"\n{'='*50}")
        print(f"Testing Groq Vision on: {test_file}")
        print(f"{'='*50}\n")

        with open(test_file, 'rb') as f:
            content = f.read()

        result = process_file(content, test_file)
        print("\n--- Extraction Result ---")
        print(json.dumps(result, indent=2))
    else:
        # Run as server
        print("\n" + "="*50)
        print("FREE OCR Service (Groq Vision)")
        print(f"Model: {GROQ_MODEL}")
        print("="*50)
        print("Endpoints:")
        print("  POST /ocr/extract  - Extract quiz data from image/PDF")
        print("  GET  /health       - Health check")
        print("="*50)

        if GROQ_API_KEY == "YOUR_GROQ_API_KEY_HERE":
            print("\n⚠️  WARNING: Set GROQ_API_KEY environment variable!")
            print("   Get free key: https://console.groq.com/keys")
            print("   Then run: set GROQ_API_KEY=your_key_here")

        print("\n")
        uvicorn.run(app, host="0.0.0.0", port=8001)
