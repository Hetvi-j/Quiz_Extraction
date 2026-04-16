"""
Gemini OCR Service - Google Gemini 2.5 Flash
Best for handwritten text extraction + semantic grading

Features:
  - Excellent handwriting recognition (trained on millions of handwritten docs)
  - Semantic understanding for grading (understands meaning, not just exact match)
  - High free tier: 1,500 requests/day, 1M+ tokens
  - Native multimodal support (images, PDFs)

Get API key: https://aistudio.google.com/apikey
Add to .env: GEMINI_API_KEY=your_key_here
"""

import os, io, json, base64, time, re, random, requests
from pathlib import Path
from dotenv import load_dotenv

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from typing import Optional
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image as PILImage
import pypdfium2 as pdfium

load_dotenv()

# ─────────────────────────────────────────────
# Configuration - Google Gemini
# ─────────────────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GEMINI_MODEL = "gemini-2.5-flash"  # Best for handwritten OCR + semantic grading

RATE_LIMIT_DELAY = 2.0  # Increased delay to avoid per-minute rate limits
MAX_RETRIES = 5
OVERLAP_RATIO = 0.45
RENDER_SCALE = 300 / 72  # 300 DPI

# Confidence settings
CONFIDENCE_THRESHOLD = float(os.environ.get("CONFIDENCE_THRESHOLD", "0.70"))
MAX_CONFIDENCE_RETRIES = int(os.environ.get("MAX_CONFIDENCE_RETRIES", "1"))

last_api_call_time = 0

QUESTION_TYPE_MAP = {
    "MCQ": "MCQ", "MULTIPLE CHOICE": "MCQ", "MULTI CHOICE": "MCQ",
    "SHORT": "SHORT", "SHORT ANSWER": "SHORT",
    "LONG": "LONG", "LONG ANSWER": "LONG", "ESSAY": "LONG", "DESCRIPTIVE": "LONG",
    "TRUE_FALSE": "TRUE_FALSE", "TRUE/FALSE": "TRUE_FALSE", "TRUEFALSE": "TRUE_FALSE",
    "FILL_BLANK": "FILL_BLANK", "FILL IN THE BLANK": "FILL_BLANK", "FILL": "FILL_BLANK",
}

# ─────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────
app = FastAPI(title="Gemini OCR Service - Google Gemini 2.5 Flash")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ─────────────────────────────────────────────
# Rate Limiting
# ─────────────────────────────────────────────
def wait_for_rate_limit():
    global last_api_call_time
    now = time.time()
    elapsed = now - last_api_call_time
    if elapsed < RATE_LIMIT_DELAY:
        time.sleep(RATE_LIMIT_DELAY - elapsed)
    last_api_call_time = time.time()


def make_gemini_request(payload: dict, timeout: int = 120) -> dict:
    """Make request to Gemini API with retry logic"""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured. Get key from https://aistudio.google.com/apikey")

    headers = {
        "Authorization": f"Bearer {GEMINI_API_KEY}",
        "Content-Type": "application/json"
    }

    for attempt in range(MAX_RETRIES):
        wait_for_rate_limit()
        try:
            response = requests.post(GEMINI_API_URL, headers=headers, json=payload, timeout=timeout)
            response.raise_for_status()
            return response.json()

        except requests.exceptions.HTTPError as e:
            status_code = e.response.status_code if e.response is not None else 500
            error_msg = str(e)
            try:
                error_msg = e.response.json().get("error", {}).get("message", str(e))
            except:
                pass

            print(f"  Gemini API error (status {status_code}): {error_msg[:200]}")

            if status_code == 429:  # Rate limited
                wait_time = min(15 * (2 ** attempt), 60)
                if attempt < MAX_RETRIES - 1:
                    print(f"  Rate limited. Waiting {wait_time}s before retry {attempt+2}/{MAX_RETRIES}...")
                    time.sleep(wait_time)
                    continue
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            raise HTTPException(status_code=500, detail=f"Gemini API error: {error_msg}")

        except requests.exceptions.Timeout:
            if attempt < MAX_RETRIES - 1:
                print(f"  Timeout. Retrying {attempt+2}/{MAX_RETRIES}...")
                time.sleep(5)
                continue
            raise HTTPException(status_code=500, detail="Gemini API timeout")

        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=500, detail=f"Gemini API failed: {e}")

    raise HTTPException(status_code=500, detail="Failed after all retries")


# ─────────────────────────────────────────────
# Image Utilities
# ─────────────────────────────────────────────
def image_to_base64(image: PILImage.Image) -> str:
    max_size = 2048
    if max(image.size) > max_size:
        ratio = max_size / max(image.size)
        new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
        image = image.resize(new_size, PILImage.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="PNG", quality=95)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def preprocess_for_ocr(image: PILImage.Image) -> PILImage.Image:
    """Minimal preprocessing - don't over-process as it can confuse mark detection"""
    try:
        from PIL import ImageEnhance
        # Light contrast boost only - avoid heavy processing
        enhanced = ImageEnhance.Contrast(image).enhance(1.2)
        return enhanced
    except:
        return image


def create_bridge_image(page_a: PILImage.Image, page_b: PILImage.Image) -> PILImage.Image:
    """Stitch bottom of page_a with top of page_b for cross-page questions"""
    w_a, h_a = page_a.size
    w_b, h_b = page_b.size
    crop_h_a = int(h_a * OVERLAP_RATIO)
    crop_h_b = int(h_b * OVERLAP_RATIO)
    bottom_a = page_a.crop((0, h_a - crop_h_a, w_a, h_a))
    top_b = page_b.crop((0, 0, w_b, crop_h_b))
    target_w = max(w_a, w_b)

    def resize_to_width(img, width):
        if img.width == width:
            return img
        ratio = width / img.width
        return img.resize((width, int(img.height * ratio)), PILImage.Resampling.LANCZOS)

    bottom_a = resize_to_width(bottom_a, target_w)
    top_b = resize_to_width(top_b, target_w)
    bridge = PILImage.new("RGB", (target_w, bottom_a.height + top_b.height), (255, 255, 255))
    bridge.paste(bottom_a, (0, 0))
    bridge.paste(top_b, (0, bottom_a.height))
    return bridge


def split_page_halves(page: PILImage.Image) -> tuple:
    """Split page into top and bottom halves"""
    w, h = page.size
    top = page.crop((0, 0, w, h // 2))
    bottom = page.crop((0, h // 2, w, h))
    return top, bottom


def pdf_to_images(pdf_bytes: bytes) -> tuple:
    """Convert PDF to page images and bridge images"""
    pages = []
    pdf = pdfium.PdfDocument(pdf_bytes)
    for page_num in range(len(pdf)):
        page = pdf[page_num]
        bitmap = page.render(scale=RENDER_SCALE)
        pil_img = bitmap.to_pil()
        pil_img = preprocess_for_ocr(pil_img)
        pages.append(pil_img)
        print(f"    Page {page_num+1}: {pil_img.size[0]}x{pil_img.size[1]} px")

    bridge_pages = []
    for i in range(len(pages) - 1):
        bridge_pages.append(create_bridge_image(pages[i], pages[i + 1]))

    return pages, bridge_pages


# ─────────────────────────────────────────────
# Answer Normalization
# ─────────────────────────────────────────────
_NO_ANSWER_STRINGS = {"unmarked", "none", "null", "n/a", "-", "not marked", "not answered", ""}

def normalize_answer(raw_answer) -> str:
    """Normalize any answer to clean string. Never returns None."""
    if raw_answer is None:
        return ""

    if isinstance(raw_answer, list):
        parts = [str(x).strip().upper() for x in raw_answer
                 if str(x).strip().lower() not in _NO_ANSWER_STRINGS]
        if not parts:
            return ""
        if all(re.match(r'^[A-D]$', p) for p in parts):
            seen, unique = set(), []
            for p in parts:
                if p not in seen:
                    seen.add(p)
                    unique.append(p)
            return ",".join(unique)
        return ", ".join(parts)

    if not isinstance(raw_answer, str):
        s = str(raw_answer).strip()
        return "" if s.lower() in _NO_ANSWER_STRINGS else s

    ans = raw_answer.strip()
    if ans.lower() in _NO_ANSWER_STRINGS:
        return ""

    if ans.startswith("[") and ans.endswith("]"):
        letters = re.findall(r'[A-D]', ans.upper())
        if letters:
            seen, unique = set(), []
            for l in letters:
                if l not in seen:
                    seen.add(l)
                    unique.append(l)
            return ",".join(unique)

    return ans


def normalize_question_type(raw_type: str) -> str:
    if not raw_type:
        return "MCQ"
    return QUESTION_TYPE_MAP.get(raw_type.upper().strip(), raw_type.upper().strip())


def parse_question_number(question_text: str):
    if not question_text:
        return None
    text = question_text.strip()
    for pat in [r'^[Qq]\.?\s*(\d+)', r'^(\d+)\s*[\.\)\:\-]', r'^[Qq]uestion\s+(\d+)']:
        m = re.match(pat, text)
        if m:
            return int(m.group(1))
    return None


def post_process_question(q: dict, idx: int, question_types: dict = None) -> dict:
    """Normalize each question after extraction"""
    # questionNumber
    groq_num = q.get("questionNumber")
    text_num = parse_question_number(q.get("questionText", ""))
    if isinstance(groq_num, int) and groq_num > 0:
        q["questionNumber"] = groq_num
    elif text_num is not None:
        q["questionNumber"] = text_num
    else:
        q["questionNumber"] = idx

    # questionType normalization first
    q["questionType"] = normalize_question_type(q.get("questionType", "MCQ"))

    # Apply question type hints from answer key
    if question_types:
        qnum_str = str(q.get("questionNumber"))
        hinted = question_types.get(qnum_str) or question_types.get(q.get("questionNumber"))
        if hinted:
            q["questionType"] = hinted

    # marks
    raw_marks = q.get("marks")
    if raw_marks is None:
        q["marks"] = 1
    else:
        marks_str = str(raw_marks).strip().replace("½", "0.5").replace("¼", "0.25")
        try:
            parsed_marks = float(marks_str)
            q["marks"] = parsed_marks if parsed_marks > 0 else 1
        except:
            q["marks"] = 1

    # Answer normalization
    raw_ans = q.get("Answer")
    q["Answer"] = normalize_answer(raw_ans)

    # For FILL_BLANK: clear any MCQ-style single letter answer
    if q["questionType"] == "FILL_BLANK":
        ans = q.get("Answer", "").strip()
        if re.fullmatch(r'[A-Da-d]', ans):
            q["Answer"] = ""
        # Strip leading option labels like "a)" or "(a)"
        q["Answer"] = re.sub(r'^[\(\[]?[a-dA-D][\)\]\.\:\s]+', '', q["Answer"]).strip()
        q["options"] = []

    # For MCQ: only allow A-D letters
    if q["questionType"] == "MCQ" and q["Answer"]:
        raw_answer = q["Answer"]
        letters = re.findall(r'[A-D]', raw_answer.upper())
        seen, unique = set(), []
        for l in letters:
            if l not in seen:
                seen.add(l)
                unique.append(l)

        # If multiple letters detected, Gemini made an error - it should only detect ONE
        if len(unique) > 1:
            q_text = q.get("questionText", "").lower()
            is_multi_select = any(phrase in q_text for phrase in [
                "select all", "choose all", "multiple", "more than one",
                "all that apply", "which of the following are"
            ])
            if not is_multi_select:
                print(f"    ⚠️  MCQ Q{q.get('questionNumber')}: DETECTION ERROR")
                print(f"        Gemini returned: {raw_answer!r} -> extracted {unique}")
                print(f"        This is wrong - student only marked ONE option")
                # For now, keep all so user can see the error
                # TODO: Re-query Gemini with stricter prompt for this specific question

        q["Answer"] = ",".join(unique) if unique else ""

    # options normalization
    if q.get("options") is None:
        q["options"] = []
    if q["questionType"] in ("SHORT", "LONG", "FILL_BLANK"):
        q["options"] = []

    print(f"  Q{q['questionNumber']} [{q['questionType']}]: Answer={q['Answer']!r}")
    return q


def post_process_questions(questions: list, question_types: dict = None) -> list:
    """Deduplicate questions from overlapping extractions"""
    seen = {}
    for q in questions:
        if q.get("options") is None:
            q["options"] = []
        qnum = q.get("questionNumber", 0)

        # Enforce question type hints after dedup
        if question_types:
            qnum_str = str(qnum)
            hinted = question_types.get(qnum_str) or question_types.get(qnum)
            if hinted:
                q["questionType"] = hinted
                if hinted == "FILL_BLANK":
                    ans = q.get("Answer", "").strip()
                    if re.fullmatch(r'[A-Da-d]', ans):
                        q["Answer"] = ""
                    q["Answer"] = re.sub(r'^[\(\[]?[a-dA-D][\)\]\.\:\s]+', '', q["Answer"]).strip()
                    q["options"] = []

        if qnum not in seen:
            seen[qnum] = q
        else:
            existing_opts = len(seen[qnum].get("options") or [])
            new_opts = len(q.get("options") or [])
            if new_opts > existing_opts:
                seen[qnum] = q
            elif new_opts == existing_opts:
                if not seen[qnum].get("Answer") and q.get("Answer"):
                    seen[qnum] = q
    return [v for _, v in sorted(seen.items())]


# ─────────────────────────────────────────────
# Gemini Prompts (optimized for handwriting)
# ─────────────────────────────────────────────
def build_main_prompt(num_pages: int, question_types: dict = None) -> str:
    qt_hints = ""
    if question_types:
        lines = ["KNOWN QUESTION TYPES FROM ANSWER KEY - USE THESE EXACTLY:"]
        for qnum in sorted(question_types.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
            lines.append(f"  Q{qnum} = {question_types[qnum]}")
        lines.append("  For FILL_BLANK: transcribe handwritten text, NOT option letters.")
        qt_hints = "\n".join(lines) + "\n\n"

    return f"""You are an expert exam paper OCR system analyzing a STUDENT ANSWER SHEET with HANDWRITTEN answers.
Look at these {num_pages} page(s) and extract EVERY question with the student's marked/written answers.

CRITICAL: DO NOT STOP EARLY! Extract ALL questions visible on the image.

Return JSON:
{{
  "documentInfo": {{
    "enrollmentNumber": "student ID if visible, else '0'",
    "date": "date if visible, else ''",
    "totalMarks": total marks as number if visible, else 0
  }},
  "questions": [
    {{
      "questionNumber": <integer>,
      "questionText": "Complete question text (never include MCQ options here)",
      "questionType": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <exact marks as printed - can be 0.5, 1, 2, 3, etc.>,
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "Answer": "see rules below"
    }}
  ]
}}

{qt_hints}QUESTION TYPES:
  MCQ        - Has A/B/C/D options. Answer="C" (SINGLE letter only, unless explicitly multi-select)
  TRUE_FALSE - Answer="True" or "False" + justification if written
  FILL_BLANK - Has blanks. Answer=EXACT handwritten text (include units like "23 dB")
  SHORT/LONG - Answer=full handwritten answer text

MCQ ANSWER DETECTION - STEP BY STEP ANALYSIS:
  For each MCQ, you MUST analyze each option separately before deciding:

  STEP 1: Look at option (a) - is there a tick (✓), circle, or underline ADDED BY STUDENT?
  STEP 2: Look at option (b) - is there a tick (✓), circle, or underline ADDED BY STUDENT?
  STEP 3: Look at option (c) - is there a tick (✓), circle, or underline ADDED BY STUDENT?
  STEP 4: Look at option (d) - is there a tick (✓), circle, or underline ADDED BY STUDENT?
  STEP 5: Return the ONE letter that has a student mark. If none found, return "".

  WHAT IS A STUDENT MARK (handwritten, not printed):
  - Tick mark: ✓ or √ (a checkmark shape)
  - Circle: drawn around the letter like ⓐ or (a) with extra circle
  - Underline: a line drawn under the option
  - Written letter: student wrote "C" or "(c)" in the margin

  WHAT IS NOT A STUDENT MARK (ignore these):
  - The printed "(a)", "(b)", "(c)", "(d)" labels - these are on ALL options
  - The printed option text
  - Smudges, shadows, or scan artifacts
  - Crossed out marks (X) = student changed their mind, SKIP this option

  IMPORTANT: The printed parentheses around option letters are NOT student marks!
  Only look for ADDITIONAL marks that the student added by hand.

FILL_BLANK CRITICAL:
  - Transcribe EXACTLY what student wrote (even if incorrect)
  - Include units: "23 dB" not just "23"
  - Never return single letter (a/b/c/d) for fill-blank
  - If blank is empty: Answer = ""

Return ONLY valid JSON."""


def build_answer_key_prompt(num_pages: int) -> str:
    return f"""You are an expert exam paper OCR extracting an ANSWER KEY from {num_pages} page(s).
This is a printed answer key - NOT a student response.

CRITICAL: Extract ALL questions visible. Do not stop early.

Return JSON:
{{
  "documentInfo": {{"enrollmentNumber": "0", "date": "", "totalMarks": 0}},
  "questions": [
    {{
      "questionNumber": <integer>,
      "questionText": "Complete question text",
      "questionType": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <exact marks - can be 0.5, 1, 2, etc.>,
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "Answer": "correct answer"
    }}
  ]
}}

For TRUE_FALSE: Include FULL justification text after True/False.
  e.g., "True - Probability of collision is 5 times less in 0.1-persistent CSMA"

For SHORT/LONG: Copy complete model answer text.

Return ONLY valid JSON."""


def build_bridge_prompt() -> str:
    return """You are analyzing a BRIDGE IMAGE (bottom of page N + top of page N+1).
Extract ONLY questions that span the page boundary.

Return JSON:
{
  "documentInfo": {"enrollmentNumber": "0", "date": "", "totalMarks": 0},
  "questions": [
    {
      "questionNumber": <integer>,
      "questionText": "Full question text",
      "questionType": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <marks>,
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "Answer": "student's answer"
    }
  ]
}

If MCQ options appear at top of lower half, they belong to question in upper half.
Return ONLY valid JSON."""


# ─────────────────────────────────────────────
# Core Extraction with Gemini
# ─────────────────────────────────────────────
def extract_with_gemini(images: list, is_bridge: bool = False, is_answer_key: bool = False,
                        question_types: dict = None) -> dict:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    image_contents = [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_to_base64(img)}"}}
        for img in images
    ]

    if is_bridge:
        prompt = build_bridge_prompt()
        label = "BRIDGE"
    elif is_answer_key:
        prompt = build_answer_key_prompt(len(images))
        label = f"ANSWER KEY {len(images)} page(s)"
    else:
        prompt = build_main_prompt(len(images), question_types)
        label = f"{len(images)} page(s)"

    content = image_contents + [{"type": "text", "text": prompt}]

    payload = {
        "model": GEMINI_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.1,
        "max_tokens": 8192,
        "response_format": {"type": "json_object"}
    }

    print(f"\n{'='*60}")
    print(f"Sending {label} to Gemini 2.5 Flash...")
    print(f"{'='*60}")

    try:
        result = make_gemini_request(payload, timeout=120)
        json_text = result["choices"][0]["message"]["content"]

        json_text = json_text.strip()
        if json_text.startswith("```"):
            parts = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        json_text = json_text.strip()

        parsed = json.loads(json_text)

        for idx, q in enumerate(parsed.get("questions", []), start=1):
            post_process_question(q, idx, question_types=question_types)

        num_q = len(parsed.get("questions", []))
        print(f"Extracted {num_q} questions from {label}")
        return parsed

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON from Gemini: {e}")
    except KeyError as e:
        raise HTTPException(status_code=500, detail=f"Unexpected Gemini response: {e}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Gemini extraction failed: {e}")


# ─────────────────────────────────────────────
# File Processing
# ─────────────────────────────────────────────
def process_file(file_bytes: bytes, filename: str, is_answer_key: bool = False,
                 question_types: dict = None) -> dict:
    ext = Path(filename).suffix.lower()
    mode_label = "ANSWER KEY" if is_answer_key else "STUDENT SHEET"

    if ext == ".pdf":
        print(f"Processing PDF ({mode_label}): {filename}")
        pages, _ = pdf_to_images(file_bytes)  # Ignore bridge images to save API calls
        print(f"  Found {len(pages)} page(s)")

        doc_info = {"enrollmentNumber": "0", "date": "", "totalMarks": 0}
        all_questions = []

        # OPTIMIZED: Process full pages (not halves) to reduce API calls
        # Old method: 3 calls per page (top, bottom, bridge) = expensive
        # New method: 1 call per page = 66% reduction in API usage
        for page_idx, page in enumerate(pages):
            print(f"\n  Processing page {page_idx + 1}/{len(pages)} [{mode_label}]...")
            try:
                result = extract_with_gemini([page], is_bridge=False,
                                              is_answer_key=is_answer_key,
                                              question_types=question_types)
                page_doc_info = result.get("documentInfo", {})
                if page_doc_info.get("enrollmentNumber") and page_doc_info["enrollmentNumber"] != "0":
                    if doc_info["enrollmentNumber"] == "0":
                        doc_info = page_doc_info
                page_qs = result.get("questions", [])
                print(f"     Page {page_idx + 1} -> {len(page_qs)} question(s)")
                all_questions.extend(page_qs)
            except Exception as e:
                print(f"  Page {page_idx + 1} failed: {e}")

        deduped = post_process_questions(all_questions, question_types=question_types)
        print(f"\n  Total after dedup: {len(deduped)} questions")
        return {"documentInfo": doc_info, "questions": deduped}

    elif ext in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"):
        print(f"Processing image ({mode_label}): {filename}")
        image = PILImage.open(io.BytesIO(file_bytes)).convert("RGB")
        image = preprocess_for_ocr(image)
        return extract_with_gemini([image], is_bridge=False, is_answer_key=is_answer_key,
                                    question_types=question_types)

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")


# ─────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────
@app.post("/ocr/extract")
async def extract_from_file(file: UploadFile = File(...),
                            question_types: Optional[str] = Form(None)):
    """Extract from STUDENT ANSWER SHEET"""
    file_bytes = await file.read()

    qt_map = {}
    if question_types:
        try:
            qt_map = json.loads(question_types)
            print(f"Question type hints: {qt_map}")
        except:
            pass

    print(f"\n{'='*50}\nProcessing STUDENT SHEET: {file.filename}")
    extraction = process_file(file_bytes, file.filename, is_answer_key=False, question_types=qt_map)
    num_q = len(extraction.get("questions", []))
    print(f"FINAL: {num_q} questions\n{'='*50}\n")
    return JSONResponse(content={"success": True, "extraction": extraction, "filename": file.filename})


@app.post("/ocr/extract-key")
async def extract_answer_key(file: UploadFile = File(...)):
    """Extract from ANSWER KEY"""
    content = await file.read()
    print(f"\n{'='*50}\nProcessing ANSWER KEY: {file.filename}")
    extraction = process_file(content, file.filename, is_answer_key=True)
    num_q = len(extraction.get("questions", []))
    print(f"FINAL: {num_q} questions\n{'='*50}\n")
    return JSONResponse(content={"success": True, "extraction": extraction, "filename": file.filename})


@app.get("/health")
async def health():
    return {
        "status": "healthy" if GEMINI_API_KEY else "needs_api_key",
        "model": GEMINI_MODEL,
        "provider": "Google Gemini",
        "version": "1.0",
        "features": [
            "Excellent handwriting recognition",
            "Semantic understanding for grading",
            "High free tier (1,500 req/day)",
            "Native multimodal support"
        ]
    }


# ─────────────────────────────────────────────
# Subjective Evaluation with Gemini
# ─────────────────────────────────────────────
def clean_text(text: str) -> str:
    if text is None:
        return ""
    return " ".join(str(text).split()).lower().strip()


def round_to_half(value: float) -> float:
    return round(value * 2) / 2


def extract_true_false(answer: str) -> tuple:
    if not answer:
        return ("", "")
    ans = answer.strip().lower()
    tf_value, justification = "", ""
    for pat in [r'^(true)\b', r'^(t)\b']:
        m = re.match(pat, ans, re.IGNORECASE)
        if m:
            tf_value, justification = "true", ans[m.end():].strip()
            break
    if not tf_value:
        for pat in [r'^(false)\b', r'^(f)\b']:
            m = re.match(pat, ans, re.IGNORECASE)
            if m:
                tf_value, justification = "false", ans[m.end():].strip()
                break
    if justification:
        justification = re.sub(r'^[\s\-\,\:\;]+', '', justification).strip()
    return (tf_value, justification)


def evaluate_subjective_answer(question: str, answer_key: str, student_answer: str,
                                max_marks: float, question_type: str = "SHORT") -> dict:
    """Evaluate subjective answer using Gemini's semantic understanding"""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if not student_answer or not student_answer.strip():
        return {"obtained_marks": 0, "percentage": 0, "feedback": "No answer provided",
                "correct_points": [], "missing_points": [answer_key] if answer_key else []}

    prompt = f"""You are an expert academic evaluator. Evaluate the student's answer semantically.
Focus on MEANING and CONCEPTS, not exact wording.

QUESTION: {question}
CORRECT ANSWER: {answer_key}
STUDENT'S ANSWER: {student_answer}
MAXIMUM MARKS: {max_marks}
QUESTION TYPE: {question_type}

Grading rules:
- Full marks if core concept/meaning is correct (even with different wording)
- Partial marks for partially correct answers
- Zero for wrong or irrelevant answers
- Be lenient with spelling errors if meaning is clear

Return ONLY JSON:
{{"obtained_marks": <0 to {max_marks}>, "percentage": <0-100>, "feedback": "<brief feedback>", "correct_points": [], "missing_points": []}}"""

    payload = {
        "model": GEMINI_MODEL,
        "messages": [
            {"role": "system", "content": "You are an expert academic evaluator. Respond with valid JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"}
    }

    try:
        result = make_gemini_request(payload, timeout=60)
        json_text = result["choices"][0]["message"]["content"].strip()
        if json_text.startswith("```"):
            parts = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        evaluation = json.loads(json_text.strip())
        raw_marks = max(0, min(float(evaluation.get("obtained_marks", 0)), max_marks))
        evaluation["obtained_marks"] = round_to_half(raw_marks)
        evaluation["percentage"] = round((evaluation["obtained_marks"] / max_marks) * 100, 2) if max_marks > 0 else 0
        return evaluation
    except Exception as e:
        return {"obtained_marks": 0, "percentage": 0, "feedback": f"Evaluation error: {e}",
                "correct_points": [], "missing_points": []}


from pydantic import BaseModel
from typing import List, Union

class QuestionEvaluation(BaseModel):
    question_number: Union[int, str]
    question_text: str
    answer_key: str
    student_answer: str
    max_marks: float
    question_type: Optional[str] = "SHORT"

class EvaluationRequest(BaseModel):
    questions: List[QuestionEvaluation]


@app.post("/evaluate/subjective")
async def evaluate_subjective(request: EvaluationRequest):
    if not request.questions:
        raise HTTPException(status_code=400, detail="No questions provided")

    print(f"\n{'='*50}\nEvaluating {len(request.questions)} answers with Gemini\n{'='*50}")
    results, total_marks, obtained_marks = [], 0, 0

    for q in request.questions:
        print(f"\nQ{q.question_number}: {q.question_text[:50]}...")

        s_ans = clean_text(q.student_answer)
        k_ans = clean_text(q.answer_key)

        if not s_ans:
            evaluation = {"obtained_marks": 0, "percentage": 0, "feedback": "No answer provided.",
                          "correct_points": [], "missing_points": [q.answer_key] if q.answer_key else []}
        elif s_ans == k_ans:
            evaluation = {"obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct.",
                          "correct_points": ["Exact match."], "missing_points": []}
        else:
            try:
                evaluation = evaluate_subjective_answer(
                    question=q.question_text, answer_key=q.answer_key,
                    student_answer=q.student_answer, max_marks=q.max_marks,
                    question_type=q.question_type or "SHORT"
                )
            except Exception as e:
                evaluation = {"obtained_marks": 0, "percentage": 0, "feedback": f"Error: {e}",
                              "correct_points": [], "missing_points": []}

        total_marks += q.max_marks
        obtained_marks += evaluation["obtained_marks"]

        results.append({
            "question_number": q.question_number,
            "question_text": q.question_text,
            "max_marks": q.max_marks,
            "obtained_marks": evaluation["obtained_marks"],
            "percentage": evaluation["percentage"],
            "feedback": evaluation["feedback"],
            "correct_points": evaluation.get("correct_points", []),
            "missing_points": evaluation.get("missing_points", []),
            "answer_key": q.answer_key,
            "student_answer": q.student_answer
        })
        print(f"   {evaluation['obtained_marks']}/{q.max_marks} ({evaluation['percentage']}%)")

    overall_pct = round((obtained_marks / total_marks) * 100, 2) if total_marks > 0 else 0
    print(f"\n{'='*50}\nTotal: {obtained_marks}/{total_marks} ({overall_pct}%)\n{'='*50}\n")
    return JSONResponse(content={
        "success": True, "total_marks": total_marks,
        "obtained_marks": round(obtained_marks, 2),
        "percentage": overall_pct, "results": results
    })


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*50)
    print("Gemini OCR Service - Google Gemini 2.5 Flash")
    print(f"Model: {GEMINI_MODEL}")
    print("="*50)
    if not GEMINI_API_KEY:
        print("\nWARNING: GEMINI_API_KEY not set in .env")
        print("Get key: https://aistudio.google.com/apikey")
    uvicorn.run(app, host="0.0.0.0", port=8002)  # Different port from Groq (8001)
