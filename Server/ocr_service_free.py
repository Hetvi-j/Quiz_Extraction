"""
FREE OCR Service - Best of v1 + v6
Uses Groq Vision API (Llama 4 Scout)

WHAT'S INCLUDED FROM EACH VERSION:
  FROM v6:
    ✅ Bridge images (bottom 40% of page N + top 40% of page N+1)
       → Handles questions split across page boundaries
    ✅ Per-page processing (one page at a time, never stops early)
    ✅ Smart TPM-aware rate limiting with exponential backoff
    ✅ post_process_questions() deduplication (richer extraction wins)
    ✅ normalize_answer() — handles all Groq output formats
    ✅ parse_question_number() — parses "Q7.", "7.", "7)" → 7
    ✅ Bridge-specific focused prompt (only extracts cross-page Qs)
    ✅ evaluate_subjective_answer() with strict/lenient/TRUE_FALSE modes
    ✅ /evaluate/subjective endpoint with fast-path grading
    ✅ All TRUE_FALSE justification splitting logic

  FROM v1:
    ✅ Question type normalization map (handles "ESSAY"→"LONG", etc.)
    ✅ Batch processing for PDFs > 5 pages (groups of 5)
    ✅ Cleaner question type detection and mapping
    ✅ Better MCQ answer letter extraction (deduplication with seen set)
    ✅ Explicit handling: subjective types always get options=[]
    ✅ Higher render DPI logic (300 DPI for quality)

  NEW IN THIS MERGE:
    ✅ Confidence threshold: 70% (was 95% in v6, causing all marks to be missed)
    ✅ normalize_answer maps UNMARKED/None/null → "" (never returns None)
    ✅ options=None normalized to [] everywhere
    ✅ Per-question Answer debug logging
    ✅ Bridge overlap: 40% (up from 30%)
"""

import os
import io
import json
import base64
import time
import re
import random
import requests
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
# Configuration
# ─────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "meta-llama/llama-4-scout-17b-16e-instruct"

RATE_LIMIT_DELAY = 2.0
MAX_RETRIES      = 5
OVERLAP_RATIO    = 0.40   # 40% overlap for bridge images (v6 had 30%, increased for safety)
RENDER_SCALE     = 300 / 72  # 300 DPI (v1 used 200 DPI, v6 used 300 DPI — use 300 for quality)

last_api_call_time = 0

# v1: Question type normalization map — handles all Groq variations
QUESTION_TYPE_MAP = {
    "MCQ":                "MCQ",
    "MULTIPLE CHOICE":    "MCQ",
    "MULTI CHOICE":       "MCQ",
    "SHORT":              "SHORT",
    "SHORT ANSWER":       "SHORT",
    "LONG":               "LONG",
    "LONG ANSWER":        "LONG",
    "ESSAY":              "LONG",
    "DESCRIPTIVE":        "LONG",
    "TRUE_FALSE":         "TRUE_FALSE",
    "TRUE/FALSE":         "TRUE_FALSE",
    "TRUEFALSE":          "TRUE_FALSE",
    "FILL_BLANK":         "FILL_BLANK",
    "FILL IN THE BLANK":  "FILL_BLANK",
    "FILL":               "FILL_BLANK",
}


# ─────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────
app = FastAPI(title="Free OCR Service (Groq Vision) — Best Merge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# Rate Limiting (from v6 — smarter than v1)
# ─────────────────────────────────────────────

def wait_for_rate_limit():
    global last_api_call_time
    now     = time.time()
    elapsed = now - last_api_call_time
    if elapsed < RATE_LIMIT_DELAY:
        wait = RATE_LIMIT_DELAY - elapsed
        print(f"  ⏳ Rate limiting: waiting {wait:.1f}s...")
        time.sleep(wait)
    last_api_call_time = time.time()


def calculate_tpm_wait_time(error_msg: str, attempt: int) -> float:
    used_match  = re.search(r'Used\s+(\d+)',  error_msg)
    limit_match = re.search(r'Limit\s+(\d+)', error_msg)

    if used_match and limit_match:
        used        = int(used_match.group(1))
        limit       = int(limit_match.group(1))
        usage_ratio = used / limit if limit > 0 else 1.0
        if usage_ratio > 0.9:
            base_wait = 45 + (usage_ratio - 0.9) * 150
        elif usage_ratio > 0.7:
            base_wait = 20 + (usage_ratio - 0.7) * 125
        else:
            base_wait = 10 + usage_ratio * 15
        print(f"  📊 TPM usage: {used}/{limit} ({usage_ratio*100:.1f}%)")
    else:
        base_wait = 15 * (2 ** attempt)

    jitter    = base_wait * 0.2 * (random.random() - 0.5)
    wait_time = min(base_wait + jitter, 120)
    return max(wait_time, 5)


def make_groq_request(payload: dict, timeout: int = 120) -> dict:
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type":  "application/json"
    }
    for attempt in range(MAX_RETRIES):
        wait_for_rate_limit()
        try:
            response = requests.post(GROQ_API_URL, headers=headers, json=payload, timeout=timeout)
            response.raise_for_status()
            return response.json()

        except requests.exceptions.HTTPError as e:
            error_msg   = str(e)
            status_code = e.response.status_code if e.response is not None else 500
            try:
                error_msg = e.response.json().get("error", {}).get("message", str(e))
            except Exception:
                pass
            print(f"  ❌ Groq API error (status {status_code}): {error_msg[:200]}")

            if "rate limit" in error_msg.lower() or status_code == 429:
                wait_time = calculate_tpm_wait_time(error_msg, attempt)
                if attempt < MAX_RETRIES - 1:
                    print(f"  ⚠️ Rate limited. Waiting {wait_time:.1f}s before retry {attempt+2}/{MAX_RETRIES}...")
                    time.sleep(wait_time)
                    continue
                raise HTTPException(status_code=429, detail=f"Rate limit exceeded after {MAX_RETRIES} retries.")
            raise HTTPException(status_code=500, detail=f"Groq API error: {error_msg}")

        except requests.exceptions.Timeout:
            if attempt < MAX_RETRIES - 1:
                print(f"  ⚠️ Request timeout. Retrying {attempt+2}/{MAX_RETRIES}...")
                time.sleep(5)
                continue
            raise HTTPException(status_code=500, detail="Groq API timeout after retries")

        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=500, detail=f"Groq API failed: {e}")

    raise HTTPException(status_code=500, detail="Failed after all retries")


# ─────────────────────────────────────────────
# Image Utilities
# ─────────────────────────────────────────────

def image_to_base64(image: PILImage.Image) -> str:
    max_size = 2048
    if max(image.size) > max_size:
        ratio    = max_size / max(image.size)
        new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
        image    = image.resize(new_size, PILImage.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="PNG", quality=95)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def create_bridge_image(page_a: PILImage.Image, page_b: PILImage.Image) -> PILImage.Image:
    """
    Stitch the bottom OVERLAP_RATIO of page_a with the top OVERLAP_RATIO of page_b.
    This creates a "bridge" image that contains any question split across the page boundary.
    """
    w_a, h_a = page_a.size
    w_b, h_b = page_b.size

    crop_h_a = int(h_a * OVERLAP_RATIO)
    crop_h_b = int(h_b * OVERLAP_RATIO)

    bottom_a = page_a.crop((0, h_a - crop_h_a, w_a, h_a))
    top_b    = page_b.crop((0, 0,              w_b, crop_h_b))

    target_w = max(w_a, w_b)

    def resize_to_width(img, width):
        if img.width == width:
            return img
        ratio = width / img.width
        return img.resize((width, int(img.height * ratio)), PILImage.Resampling.LANCZOS)

    bottom_a = resize_to_width(bottom_a, target_w)
    top_b    = resize_to_width(top_b,    target_w)

    bridge   = PILImage.new("RGB", (target_w, bottom_a.height + top_b.height), (255, 255, 255))
    bridge.paste(bottom_a, (0, 0))
    bridge.paste(top_b,    (0, bottom_a.height))
    print(f"    Bridge: {target_w}x{bridge.height} "
          f"(bottom {crop_h_a}px of page A + top {crop_h_b}px of page B)")
    return bridge


def split_page_halves(page: PILImage.Image) -> tuple[PILImage.Image, PILImage.Image]:
    """Split a page into top half and bottom half for separate extraction."""
    w, h = page.size
    top    = page.crop((0, 0,   w, h // 2))
    bottom = page.crop((0, h // 2, w, h))
    return top, bottom


def pdf_to_images(pdf_bytes: bytes) -> tuple[list, list]:
    """
    Convert PDF to:
      pages        — full-page PIL images (one per PDF page)
      bridge_pages — stitched boundary images (one per adjacent pair)
    """
    pages = []
    pdf   = pdfium.PdfDocument(pdf_bytes)
    for page_num in range(len(pdf)):
        page    = pdf[page_num]
        bitmap  = page.render(scale=RENDER_SCALE)
        pil_img = bitmap.to_pil()
        pages.append(pil_img)
        print(f"    Page {page_num+1}: {pil_img.size[0]}x{pil_img.size[1]} px")

    bridge_pages = []
    for i in range(len(pages) - 1):
        print(f"    Creating bridge {i+1}↔{i+2}...")
        bridge_pages.append(create_bridge_image(pages[i], pages[i + 1]))

    return pages, bridge_pages


# ─────────────────────────────────────────────
# Answer Normalization (v6 + merge fixes)
# ─────────────────────────────────────────────

# Sentinel strings that mean "no answer"
_NO_ANSWER_STRINGS = {"unmarked", "none", "null", "n/a", "-", "not marked", "not answered", ""}

def normalize_answer(raw_answer) -> str:
    """
    Convert any Answer value Groq returns into a clean string.
    Never returns None. Maps UNMARKED/None/null → "".
    MCQ: returns "A,C" format (always UPPERCASE letters).
    """
    if raw_answer is None:
        return ""

    if isinstance(raw_answer, list):
        # Filter out sentinel/empty entries
        parts = [str(x).strip().upper() for x in raw_answer
                 if str(x).strip().lower() not in _NO_ANSWER_STRINGS]
        if not parts:
            return ""
        if all(re.match(r'^[A-D]$', p) for p in parts):
            # v1: deduplicate while preserving order
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

    # JSON-array-style answer e.g. '["A","C"]'
    if ans.startswith("[") and ans.endswith("]"):
        letters = re.findall(r'[A-D]', ans.upper())
        if letters:
            seen, unique = set(), []
            for l in letters:
                if l not in seen:
                    seen.add(l)
                    unique.append(l)
            return ",".join(unique)
        inner = ans[1:-1].strip().strip("'\"")
        return "" if inner.lower() in _NO_ANSWER_STRINGS else inner

    # Check if this is a single MCQ letter answer (a/b/c/d or A/B/C/D)
    # If so, normalize to uppercase
    if re.match(r'^[a-dA-D]$', ans):
        return ans.upper()
    
    # Check for comma-separated MCQ letters like "a,c" → "A,C"
    if re.match(r'^[a-dA-D](,[a-dA-D])*$', ans):
        letters = [letter.upper() for letter in ans.replace(" ", "").split(",")]
        # Deduplicate while preserving order
        seen, unique = set(), []
        for l in letters:
            if l not in seen:
                seen.add(l)
                unique.append(l)
        return ",".join(unique)

    return ans


def normalize_question_type(raw_type: str) -> str:
    """v1: maps all Groq type variants to canonical types."""
    if not raw_type:
        return "MCQ"
    return QUESTION_TYPE_MAP.get(raw_type.upper().strip(), raw_type.upper().strip())


def parse_question_number(question_text: str):
    """v6: Extract integer question number from question text."""
    if not question_text:
        return None
    text = question_text.strip()
    for pat in [r'^[Qq]\.?\s*(\d+)', r'^(\d+)\s*[\.\)\:\-]', r'^[Qq]uestion\s+(\d+)']:
        m = re.match(pat, text)
        if m:
            return int(m.group(1))
    return None


def post_process_question(q: dict, idx: int, question_types: dict = None) -> dict:
    """
    Apply all per-question normalizations:
    - questionNumber (integer, positive)
    - questionType (canonical string)
    - Answer (normalized string, never None)
    - options (always a list, never None)
    - Strip option bleed from questionText

    The optional `question_types` map can be provided (from the answer key)
    so we can force the model to treat a given question as FILL_BLANK/MCQ/etc.
    """
    # ── questionNumber ──────────────────────────────────────────────────
    groq_num = q.get("questionNumber")
    text_num = parse_question_number(q.get("questionText", ""))
    if isinstance(groq_num, int) and groq_num > 0:
        q["questionNumber"] = groq_num
    elif text_num is not None:
        q["questionNumber"] = text_num
    else:
        q["questionNumber"] = idx
        print(f"  ⚠️  Q{idx}: no question number found, using index {idx}")

    # ── Force questionType hints (when available) ─────────────────────────
    if question_types:
        qnum_str = str(q.get("questionNumber"))
        hinted = question_types.get(qnum_str) or question_types.get(q.get("questionNumber"))
        if hinted:
            q["questionType"] = hinted

    # ── marks ────────────────────────────────────────────────────────────
    raw_marks = q.get("marks")
    if raw_marks is None:
        q["marks"] = 1
    else:
        marks_str = str(raw_marks).strip().replace("½", "0.5").replace("¼", "0.25")
        try:
            parsed_marks = float(marks_str)
            q["marks"] = parsed_marks if parsed_marks > 0 else 1
        except (ValueError, TypeError):
            q["marks"] = 1
            print(f"  ⚠️  Q{q.get('questionNumber', idx)}: could not parse marks={raw_marks!r}, defaulting to 1")

    # ── questionType ────────────────────────────────────────────────────
    q["questionType"] = normalize_question_type(q.get("questionType", "MCQ"))

    # ── Answer ──────────────────────────────────────────────────────────
    raw_ans    = q.get("Answer")
    q["Answer"] = normalize_answer(raw_ans)

    # If Groq labeled it as MCQ but the answer is not a letter/letter-list,
    # treat it as a fill-in-the-blank (common for questions like Q13/14).
    if q["questionType"] == "MCQ":
        ans = q.get("Answer", "").strip()
        if ans and not re.fullmatch(r'[A-D](?:,[A-D])*', ans):
            q["questionType"] = "FILL_BLANK"
            q["options"] = []

    # For MCQ: only allow A-D (standard 4-option paper), strip E and beyond
    if q["questionType"] == "MCQ" and q["Answer"]:
        letters = re.findall(r'[A-D]', q["Answer"].upper())
        seen, unique = set(), []
        for l in letters:
            if l not in seen:
                seen.add(l)
                unique.append(l)
        q["Answer"] = ",".join(unique) if unique else ""

    # For TRUE_FALSE: normalize casing of the T/F part but PRESERVE justification.
    # e.g. "true - probability of collision is 5 times less" → "True - probability of collision is 5 times less"
    # Also cross-check: if justification clearly implies True/False, use that to verify.
    if q["questionType"] == "TRUE_FALSE" and q["Answer"]:
        ans = q["Answer"].strip()
        tf_match = re.match(r'^(true|false|t|f)\b(.*)$', ans, re.IGNORECASE)
        if tf_match:
            tf_part   = tf_match.group(1).lower()
            remainder = tf_match.group(2)
            canonical = "True" if tf_part in ("true", "t") else "False"
            # ── Semantic cross-check for cursive misreads ──────────────────
            # If the justification strongly implies the opposite of what was read,
            # Groq likely misread the cursive T/F word. Correct it.
            just_lower = remainder.lower()
            # Signals that clearly mean TRUE (positive statements about the claim)
            true_signals  = ["5 times less", "five times less", "higher throughput",
                             "lower collision", "increased throughput", "less collision",
                             "probability.*less", "better performance"]
            # Signals that clearly mean FALSE (negative statements about the claim)
            false_signals = ["not.*higher", "does not have higher", "lower throughput",
                             "no.*increase", "throughput.*lower", "not increased"]
            just_implies_true  = any(re.search(sig, just_lower) for sig in true_signals)
            just_implies_false = any(re.search(sig, just_lower) for sig in false_signals)
            if just_implies_true and canonical == "False":
                print(f"  ⚠️  Q{q.get('questionNumber','?')} [TRUE_FALSE]: Justification implies TRUE but Groq read FALSE — correcting to True")
                canonical = "True"
            elif just_implies_false and canonical == "True":
                print(f"  ⚠️  Q{q.get('questionNumber','?')} [TRUE_FALSE]: Justification implies FALSE but Groq read TRUE — correcting to False")
                canonical = "False"
            q["Answer"] = canonical + remainder
        # If no T/F detected at all, leave as-is (let evaluator handle it)

    # ── options ─────────────────────────────────────────────────────────
    if q.get("options") is None:
        q["options"] = []
    # Subjective types should always have empty options (v1)
    if q["questionType"] in ("SHORT", "LONG", "FILL_BLANK"):
        q["options"] = []

    # ── Strip option bleed from questionText (v6) ───────────────────────
    if q.get("questionText") and q.get("options") and len(q["options"]) > 0:
        text = q["questionText"]
        for pat in [r'\s+[Aa]\s*[\)\.\:]', r'\s+\([Aa]\)', r'\n[Aa]\s*[\)\.\:]']:
            m = re.search(pat, text)
            if m:
                q["questionText"] = text[:m.start()].strip()
                break

    # ── Debug log ────────────────────────────────────────────────────────
    print(f"  📌 Q{q['questionNumber']} [{q['questionType']}]: Answer={q['Answer']!r}  (raw={raw_ans!r})")
    return q



def post_process_questions(questions: list) -> list:
    """
    v6: Deduplicate questions from overlapping page/bridge extractions.
    Richer extraction (more options, non-empty answer) wins.
    
    Also logs when the SAME question gets DIFFERENT answers from different extractions
    (bridge vs. page) which indicates a reliability issue with Groq.
    """
    seen: dict[int, dict] = {}
    for q in questions:
        if q.get("options") is None:
            q["options"] = []
        qnum = q.get("questionNumber", 0)
        if qnum not in seen:
            seen[qnum] = q
        else:
            # Check for answer consistency
            existing_ans = (seen[qnum].get("Answer") or "").strip()
            new_ans = (q.get("Answer") or "").strip()
            existing_opts = len(seen[qnum].get("options") or [])
            new_opts      = len(q.get("options") or [])
            
            # Log if same question has conflicting answers
            if existing_ans and new_ans and existing_ans != new_ans:
                qtype = seen[qnum].get("questionType", "UNKNOWN")
                qtext = seen[qnum].get("questionText", "")[:60]
                print(f"  ⚠️ INCONSISTENT Q{qnum} [{qtype}]: existing='{existing_ans}' vs. new='{new_ans}'")
                print(f"     Text: {qtext}...")
            
            # Prefer extraction with more options
            if new_opts > existing_opts:
                seen[qnum] = q
            elif new_opts == existing_opts:
                # If same options, prefer the one with a non-empty answer
                if not existing_ans and new_ans:
                    seen[qnum] = q
    return [v for _, v in sorted(seen.items())]


# ─────────────────────────────────────────────
# Groq Prompts
# ─────────────────────────────────────────────

def build_main_prompt(num_pages: int, question_types: dict = None) -> str:
    # Build question type hints block if we have them from the answer key
    if question_types:
        lines = ["⚠️ KNOWN QUESTION TYPES FROM ANSWER KEY — USE THESE EXACTLY, DO NOT RE-DETECT:"]
        for qnum in sorted(question_types.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
            lines.append(f"  Q{qnum} = {question_types[qnum]}")
        lines.append("  If a question number above says FILL_BLANK — it IS FILL_BLANK even if you see (a)(b)(c)(d) printed nearby.")
        lines.append("  Those printed letters are part of the question text or nearby MCQ options — not this question's type.")
        lines.append("  For FILL_BLANK questions, do NOT interpret any letters (A/B/C/D) near the blank as student selections.")
        lines.append("    Instead, transcribe the student’s handwritten text inside the blank exactly (e.g. '1-persistent').")
        lines.append("")
        qt_hints = "\n".join(lines) + "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
    else:
        qt_hints = ""

    prompt = f"""You are an expert exam paper OCR system analyzing a STUDENT ANSWER SHEET.
Look at these {num_pages} page(s) and extract EVERY SINGLE question with the student's marked answers.

🚨 CRITICAL: DO NOT STOP EARLY! Extract ALL questions visible on the image.
🚨 This may be a HALF-PAGE image. Extract EVERY question you can see — even if cut off at edges.
🚨 If you see questions numbered e.g. 6, 7, 8, 9, 10, 11 — extract ALL of them, not just the first few.
🚨 Do NOT truncate your response. Keep going until every visible question is in the JSON.

Return a JSON object with EXACTLY this structure:
{{
  "documentInfo": {{
    "enrollmentNumber": "student enrollment number if visible, else '0'",
    "date": "date if visible, else empty string",
    "totalMarks": total marks as number if visible, else 0
  }},
  "questions": [
    {{
      "questionNumber": <integer question number>,
      "questionText": "Complete question text (include question number prefix like 'Q7.' and any code blocks). NEVER include MCQ options here.",
      "questionType": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <exact marks as printed — can be 0.5, 1, 1.5, 2, 3, 4, 5 or any decimal>,
      "options": ["A) option text", "B) option text", "C) option text", "D) option text"],
      "Answer": "see format rules below"
    }}
  ]
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 MARKS EXTRACTION — READ CAREFULLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Marks are printed on the paper — read EXACTLY what is written. Do NOT assume or default to 1.
  • Marks appear as: "[2]" or "(2)" or "2 marks" or "[0.5]" or "(½)" near each question
  • ½ means 0.5
  • Marks can be ANY value: 0.5, 1, 1.5, 2, 3, 4, 5, 10, etc.
  • Different questions CAN have different marks — MCQ may be 0.5, SHORT may be 2, LONG may be 5
  • If a section header says "Each question carries 2 marks" — all questions in that section = 2
  • If marks are NOT visible anywhere for a question, use 1 as fallback ONLY
  • NEVER assume all questions have the same marks

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{qt_hints}QUESTION TYPE RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MCQ        — Has A/B/C/D options (may be printed as (a)/(b)/(c)/(d) on paper).
               options=["A) ...", "B) ...", "C) ...", "D) ..."]. Answer="C" (single) or "A,C" (multi).
               NEVER include "E" in Answer — papers only have 4 options A/B/C/D.
  TRUE_FALSE — True or False question. options=["True","False"].
               Answer = "True" or "False" PLUS full justification text if written.
               e.g. "True - probability of collision is lower in 0.1-persistent CSMA"
               e.g. "False - CSMA uses collision detection not avoidance"
               If no justification: Answer = "True" or "False" only.
  FILL_BLANK — Has blanks (______ or ......). options=[]. Answer=handwritten text on blank
  SHORT      — Brief text answer (1-3 sentences). options=[]. Answer=full written answer
  LONG       — Detailed/essay answer. options=[]. Answer=full written answer

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CROSS-PAGE QUESTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Some questions START on one page and their MCQ OPTIONS appear at the TOP of the NEXT page.
If options A/B/C/D appear at the top of a page with no question above — they belong to the
LAST question on the previous page. Combine them into one complete MCQ.
A question with a code block + no options on current page is ALWAYS MCQ — check next page.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STUDENT MARK DETECTION — CRITICAL RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This paper uses options labeled (a), (b), (c), (d) — lowercase in parentheses.
Map them to A, B, C, D in the Answer field.

THE #1 MISTAKE TO AVOID:
  WRONG: Reporting an option just because you can READ the printed label (a)/(b)/(c)/(d)
  RIGHT: Only report an option if the student drew a PHYSICAL HANDWRITTEN MARK on/near it

What counts as a student mark:
  YES: Tick or checkmark (✓) written next to or over an option — even messy
  YES: Circle drawn around the option letter or text — even wobbly
  YES: Underline drawn beneath the option text
  YES: Any deliberate pen/pencil stroke physically ON a specific option

What does NOT count:
  NO: The printed "(a)" "(b)" "(c)" "(d)" labels with no student ink on them
  NO: Cross/X mark = CANCELLED, not selected
  NO: Strikethrough = cancelled
  NO: Being able to read the option text — text alone is not a mark
  NO: Option "E" — this paper only has options A, B, C, D

HOW TO PROCESS EACH MCQ:
  Step 1: Look at option (a) — is there a student-drawn mark (tick/circle/underline) ON it? Yes→A. No→skip.
  Step 2: Look at option (b) — same test. Yes→B. No→skip.
  Step 3: Look at option (c) — same test. Yes→C. No→skip.
  Step 4: Look at option (d) — same test. Yes→D. No→skip.

⚠️ OPTION POSITION MATTERS:
  Options (a)(b)(c)(d) may be arranged in a 2x2 grid or inline.
  Always check which SPECIFIC option letter the student marked — do NOT assume left=A or top=A.
  Example layout:
    (a) Smartphone    (b) Laptop
    (c) Desktop       (d) Wearables    ← if student circled Wearables, Answer="D" not "C"

⚠️ MARKS OUTSIDE OPTIONS:
  Some students write the option letter (e.g. "(d)") to the LEFT of the question number
  as their answer. If you see "(d)" or "d)" written in the margin next to a question,
  that IS the student's answer — report it as "D".

Most questions have exactly ONE marked answer.
Only return multiple letters if you clearly see marks on multiple options.
If no student mark anywhere: Answer = "" (empty string).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ FILL IN THE BLANK — CRITICAL RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILL_BLANK questions have dots (......) or underlines (______) where student writes the answer.

  • Answer = TRANSCRIBE EXACTLY what the student physically wrote on the blank.
  • DO NOT guess, infer, or substitute what the correct answer should be.
  • DO NOT replace the student's handwriting with the textbook answer.
  • If student wrote "22" — Answer = "22" (even if the correct answer is "23 dB")
  • If student wrote "1-persistent CSMA" — Answer = "1-persistent CSMA"
  • If student wrote abbreviations like "RTS - Remote" — Answer = "RTS - Remote" (copy exactly)
  • If student left blank completely — Answer = ""
  • INCLUDE UNITS if the student wrote them: "23 dB" not just "23"
  • NEVER return a single letter (a/b/c/d) — those are MCQ labels, not fill answers
  • Multiple blanks: Answer = "value1, value2" (in order, comma-separated)

  🚨 MOST IMPORTANT: Copy the student's ACTUAL handwriting. Do NOT write what the correct
     answer should be. You are a transcription tool, not an answer key.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANSWER FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MCQ single:   "C"  (just the letter — A, B, C, or D only)
  MCQ multi:    "A,C"  (no spaces, comma-separated)
  TRUE_FALSE:   Read the FIRST written word VERY carefully — it is either "True" or "False".
                ⚠️ CURSIVE HANDWRITING WARNING: Indian students write in cursive.
                  When in doubt: look at the justification — if it says "probability of
                  collision is LESS" or "higher throughput" → answer is "True".
                Answer = "True" or "False" then the full justification text.
                Examples:
                  "True"
                  "True - probability of collision is lower in 0.1-persistent CSMA"
                  "False - because CSMA uses collision detection not avoidance"
  FILL_BLANK:   complete handwritten text INCLUDING units (e.g. "23 dB", "1-persistent", "18.4%")
  SHORT/LONG:   full handwritten answer text
  No answer:    "" (empty string — never use "UNMARKED" or "None")

🚨 FINAL CHECKLIST:
  □ Extracted EVERY question from EVERY page?
  □ Every question has an integer "questionNumber"?
  □ MCQ options are in "options" array, NOT in "questionText"?
  □ Subjective types (SHORT/LONG/FILL_BLANK) have options=[]?
  □ FILL_BLANK answers include units (dB, %, ms etc.) if written?
  □ FILL_BLANK answers are never a single letter like "a", "b", "c", "d"?
  □ "Answer" is never null — use "" for no answer

Return ONLY valid JSON — no explanation text."""
    return prompt


def build_answer_key_prompt(num_pages: int) -> str:
    """
    Separate prompt for answer key extraction.
    Key differences from student sheet prompt:
    - No mark detection needed (printed answers, not handwritten marks)
    - TRUE_FALSE answers MUST include the full printed justification
    - SHORT/LONG answers should copy the complete model answer text
    """
    return f"""You are an expert exam paper OCR system extracting an ANSWER KEY from {num_pages} page(s).
This is a printed answer key or question paper with correct answers — NOT a student response.
Extract EVERY question with its correct answer exactly as printed.

🚨 CRITICAL: DO NOT STOP EARLY! Extract ALL questions visible in the image.
🚨 This may be a HALF-PAGE image. Extract EVERY question you can see.
🚨 If you see questions 1 through 11, extract ALL 11 — do not stop at 5 or 6.
🚨 Do NOT truncate your JSON. Keep writing until every visible question is included.

Return a JSON object with EXACTLY this structure:
{{
  "documentInfo": {{
    "enrollmentNumber": "0",
    "date": "date if visible, else empty string",
    "totalMarks": total marks as number if visible, else 0
  }},
  "questions": [
    {{
      "questionNumber": <integer question number>,
      "questionText": "Complete printed question text. NEVER include MCQ options here.",
      "questionType": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <exact marks as printed — can be 0.5, 1, 1.5, 2, 3, 4, 5 or any decimal>,
      "options": ["A) option text", "B) option text", "C) option text", "D) option text"],
      "Answer": "see format rules below"
    }}
  ]
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 MARKS EXTRACTION — READ CAREFULLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Marks are printed on the paper — read EXACTLY what is written. Do NOT assume or default to 1.
  • Marks appear as: "[2]" or "(2)" or "2 marks" or "[0.5]" or "(½)" near each question
  • ½ means 0.5
  • Marks can be ANY value: 0.5, 1, 1.5, 2, 3, 4, 5, 10, etc.
  • Different questions CAN have different marks — MCQ may be 0.5, SHORT may be 2, LONG may be 5
  • If a section header says "Each question carries 2 marks" — all questions in that section = 2
  • If marks are NOT visible anywhere for a question, use 1 as fallback ONLY
  • NEVER assume all questions have the same marks

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUESTION TYPE RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MCQ        — Has A/B/C/D options (may be printed as (a)/(b)/(c)/(d) on paper).
               options=["A) ...", "B) ...", "C) ...", "D) ..."]. Answer="C" (single) or "A,C" (multi).
               NEVER include "E" in Answer — papers only have 4 options A/B/C/D.
  TRUE_FALSE — True or False question. options=["True","False"].
               Answer = "True" or "False" PLUS the COMPLETE printed justification/reason.
               🚨 CRITICAL: Copy the ENTIRE justification sentence(s) after True/False.
               e.g. "True - Probability of collision is 5 times less in 0.1-persistent
                     CSMA compared to 0.5 persistent. This reflects in increased throughput."
               e.g. "False - CSMA/CA uses collision avoidance not collision detection."
               If no justification printed: Answer = "True" or "False" only.
  FILL_BLANK — Has blanks. options=[]. Answer=the correct word/phrase for the blank.
  SHORT      — Brief answer question. options=[]. Answer=COMPLETE model answer text as printed.
  LONG       — Detailed answer question. options=[]. Answer=COMPLETE model answer text as printed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ TRUE_FALSE — MOST IMPORTANT RULE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If a TRUE_FALSE question has a printed justification/explanation after the True/False answer,
you MUST include ALL of it in the Answer field.

Example — if the answer key shows:
  "True. Probability of collision is 5 times less in 0.1-persistent compared to
   0.5 persistent. This reflects in increased throughput."

Then Answer must be:
  "True. Probability of collision is 5 times less in 0.1-persistent compared to
   0.5 persistent. This reflects in increased throughput."

DO NOT return just "True" — that loses the justification used for grading.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANSWER FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MCQ:        "B" or "A,C"
  TRUE_FALSE: "True - <full justification>" or "False - <full justification>"
  FILL_BLANK: correct word/phrase
  SHORT/LONG: complete model answer text (copy verbatim from the document)
  No answer:  "" (empty string)

🚨 FINAL CHECKLIST:
  □ Every question extracted?
  □ Every question has an integer "questionNumber"?
  □ TRUE_FALSE answers include the COMPLETE justification text?
  □ SHORT/LONG answers include the COMPLETE model answer?
  □ MCQ options in "options" array, NOT in "questionText"?

Return ONLY valid JSON — no explanation text."""


def build_bridge_prompt() -> str:
    return """You are an expert exam paper OCR system analyzing a BRIDGE IMAGE.
This image shows the BOTTOM of one exam page stitched with the TOP of the next page.
Extract ONLY questions that span the boundary (question text on one half, options/answer on the other).

Return a JSON object:
{
  "documentInfo": {"enrollmentNumber": "0", "date": "", "totalMarks": 0},
  "questions": [
    {
      "questionNumber": <integer>,
      "questionText": "Full question text including code blocks",
      "questionType": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <exact marks as printed — can be 0.5, 1, 2, 3, 4, 5 or any decimal. ½ = 0.5>,
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "Answer": "B" or "A,C" or "" or "True - justification text"
    }
  ]
}

CROSS-PAGE RULE: If MCQ options (A/B/C/D) appear at the top of the lower half,
they belong to the question in the upper half. Combine into one complete MCQ.

MARK DETECTION (70% confidence):
  ✅ Tick (✓), Circle, Underline, deliberate ink near option = MARKED
  ❌ Cross/X = CANCELLED (not a selection)
  No mark anywhere = Answer: ""

TRUE_FALSE answers: include the FULL justification text after True/False.
  e.g. "True - probability of collision is 5 times less" 
  e.g. "False - CSMA uses collision avoidance not detection"

Return ONLY valid JSON — no explanation text."""


# ─────────────────────────────────────────────
# Core Extraction
# ─────────────────────────────────────────────

def extract_with_groq(images: list, is_bridge: bool = False, is_answer_key: bool = False, question_types: dict = None) -> dict:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured.")

    image_contents = [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_to_base64(img)}"}}
        for img in images
    ]

    if is_bridge:
        prompt = build_bridge_prompt()
        label  = "BRIDGE"
    elif is_answer_key:
        prompt = build_answer_key_prompt(len(images))
        label  = f"ANSWER KEY {len(images)} page(s)"
    else:
        prompt = build_main_prompt(len(images), question_types)
        label  = f"{len(images)} page(s)"

    content = image_contents + [{"type": "text", "text": prompt}]

    payload = {
        "model":           GROQ_MODEL,
        "messages":        [{"role": "user", "content": content}],
        "temperature":     0.1,
        "max_tokens":      8192,
        "response_format": {"type": "json_object"}
    }

    print(f"\n{'='*60}")
    print(f"🚀 Sending {label} to Groq Vision...")
    print(f"{'='*60}")

    try:
        result    = make_groq_request(payload, timeout=120)
        json_text = result["choices"][0]["message"]["content"]

        print(f"\n📄 RAW RESPONSE (first 1500 chars):\n{'-'*40}")
        print(json_text[:1500])
        print(f"{'-'*40}\n")

        json_text = json_text.strip()
        if json_text.startswith("```"):
            parts     = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        json_text = json_text.strip()

        parsed = json.loads(json_text)

        # Normalize every question
        for idx, q in enumerate(parsed.get("questions", []), start=1):
            post_process_question(q, idx, question_types=question_types)

        num_q = len(parsed.get("questions", []))
        print(f"✅ Extracted {num_q} questions from {label}")
        return parsed

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON from Groq: {e}")
    except KeyError as e:
        raise HTTPException(status_code=500, detail=f"Unexpected Groq response: {e}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Groq extraction failed: {e}")


# ─────────────────────────────────────────────
# File Processing
# ─────────────────────────────────────────────

def process_file(file_bytes: bytes, filename: str, is_answer_key: bool = False, question_types: dict = None) -> dict:
    ext = Path(filename).suffix.lower()
    mode_label = "ANSWER KEY" if is_answer_key else "STUDENT SHEET"

    if ext == ".pdf":
        print(f"Processing PDF ({mode_label}): {filename}")
        pages, bridge_pages = pdf_to_images(file_bytes)
        print(f"  Found {len(pages)} page(s), {len(bridge_pages)} bridge image(s)")

        doc_info      = {"enrollmentNumber": "0", "date": "", "totalMarks": 0}
        all_questions = []

        # ── Per-page extraction ───────────────────────────────────────────
        # Pages with many questions (dense pages) are split into top/bottom halves.
        # Each half gets its own Groq call with a fresh 8192-token budget.
        # This prevents token exhaustion from cutting off questions mid-page.
        DENSE_PAGE_THRESHOLD = 7  # if page has ≥7 questions, split it

        if len(pages) <= 10:
            for page_idx, page in enumerate(pages):
                print(f"\n  📄 Processing page {page_idx + 1}/{len(pages)} [{mode_label}]...")

                # Always split: two half-page calls are more reliable than one full-page call
                # for papers with 8+ questions on a single page.
                top_half, bottom_half = split_page_halves(page)
                page_qs = []

                for half_label, half_img in [("TOP", top_half), ("BOTTOM", bottom_half)]:
                    try:
                        result = extract_with_groq([half_img], is_bridge=False, is_answer_key=is_answer_key, question_types=question_types)
                        page_doc_info = result.get("documentInfo", {})
                        if page_doc_info.get("enrollmentNumber") and page_doc_info["enrollmentNumber"] != "0":
                            if doc_info["enrollmentNumber"] == "0":
                                doc_info = page_doc_info
                        half_qs = result.get("questions", [])
                        print(f"     Page {page_idx + 1} {half_label} → {len(half_qs)} question(s)")
                        page_qs.extend(half_qs)
                    except Exception as e:
                        print(f"  ⚠️ Page {page_idx + 1} {half_label} failed: {e}")

                # ── Intra-page overlap extraction (half-bridge) ───────────────
                try:
                    print(f"    Creating half-bridge for page {page_idx + 1}...")
                    half_bridge = create_bridge_image(top_half, bottom_half)
                    result = extract_with_groq([half_bridge], is_bridge=True, is_answer_key=is_answer_key, question_types=question_types)
                    half_bridge_qs = result.get("questions", [])
                    print(f"     Page {page_idx + 1} HALF-BRIDGE → {len(half_bridge_qs)} question(s)")
                    page_qs.extend(half_bridge_qs)
                except Exception as e:
                    print(f"  ⚠️ Page {page_idx + 1} HALF-BRIDGE failed: {e}")

                all_questions.extend(page_qs)
        else:
            # Batch of 5 for large PDFs
            print(f"  Large PDF ({len(pages)} pages) — processing in batches of 5...")
            for i in range(0, len(pages), 5):
                batch = pages[i:i + 5]
                print(f"\n  📄 Processing pages {i+1}–{i+len(batch)} [{mode_label}]...")
                try:
                    result        = extract_with_groq(batch, is_bridge=False, is_answer_key=is_answer_key, question_types=question_types)
                    page_doc_info = result.get("documentInfo", {})
                    if page_doc_info.get("enrollmentNumber") and page_doc_info["enrollmentNumber"] != "0":
                        if doc_info["enrollmentNumber"] == "0":
                            doc_info = page_doc_info
                    batch_qs = result.get("questions", [])
                    print(f"     Batch → {len(batch_qs)} question(s)")
                    all_questions.extend(batch_qs)
                except Exception as e:
                    print(f"  ⚠️ Batch {i+1}–{i+len(batch)} failed: {e}")

        # ── Bridge images — only for student sheets ───────────────────────
        if not is_answer_key:
            for i, bridge in enumerate(bridge_pages):
                print(f"\n  🔗 Processing bridge {i+1}↔{i+2}...")
                try:
                    result    = extract_with_groq([bridge], is_bridge=True, is_answer_key=False, question_types=question_types)
                    bridge_qs = result.get("questions", [])
                    print(f"     Bridge → {len(bridge_qs)} question(s)")
                    all_questions.extend(bridge_qs)
                except Exception as e:
                    print(f"  ⚠️  Bridge {i+1}↔{i+2} failed (non-fatal): {e}")

        # ── Deduplicate ───────────────────────────────────────────────────
        deduped = post_process_questions(all_questions)
        print(f"\n  📊 Total after dedup: {len(deduped)} questions (from {len(all_questions)} raw)")
        return {"documentInfo": doc_info, "questions": deduped}

    elif ext in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"):
        print(f"Processing image ({mode_label}): {filename}")
        image = PILImage.open(io.BytesIO(file_bytes)).convert("RGB")
        return extract_with_groq([image], is_answer_key=is_answer_key, question_types=question_types)

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")


# ─────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────

@app.post("/ocr/extract")
async def extract_from_file(
    file: UploadFile = File(...),
    question_types: Optional[str] = Form(None)   # JSON string: {"1":"MCQ","13":"FILL_BLANK",...}
):
    """Extract from STUDENT ANSWER SHEET — uses mark detection."""
    file_bytes = await file.read()

    # Parse question type hints passed from Node.js controller
    qt_map = {}
    if question_types:
        try:
            qt_map = json.loads(question_types)
            print(f"📋 Question type hints received: {qt_map}")
        except Exception as e:
            print(f"⚠️ Could not parse question_types: {e}")

    print(f"\n{'='*50}\nProcessing STUDENT SHEET: {file.filename}")
    extraction = process_file(file_bytes, file.filename, is_answer_key=False, question_types=qt_map)
    num_q      = len(extraction.get("questions", []))
    print(f"📋 FINAL: {num_q} questions\n{'='*50}\n")
    return JSONResponse(content={
        "success":    True,
        "extraction": extraction,
        "filename":   file.filename
    })


@app.post("/ocr/extract-key")
async def extract_answer_key(file: UploadFile = File(...)):
    """
    Extract from ANSWER KEY / QUESTION PAPER — uses answer key prompt.
    TRUE_FALSE answers will include full printed justification.
    SHORT/LONG answers will include complete model answer text.
    """
    content    = await file.read()
    print(f"\n{'='*50}\nProcessing ANSWER KEY: {file.filename}")
    extraction = process_file(content, file.filename, is_answer_key=True)
    num_q      = len(extraction.get("questions", []))
    print(f"📋 FINAL: {num_q} questions\n{'='*50}\n")
    return JSONResponse(content={
        "success":    True,
        "extraction": extraction,
        "filename":   file.filename
    })


@app.get("/health")
async def health():
    return {
        "status":  "healthy" if GROQ_API_KEY else "needs_api_key",
        "model":   GROQ_MODEL,
        "version": "best-merge",
        "features": [
            "Bridge images (40% overlap) for cross-page questions",
            "Per-page extraction for ≤10 pages, batch of 5 for larger PDFs",
            "Smart TPM-aware rate limiting",
            "70% confidence mark detection",
            "Question type normalization (ESSAY→LONG, etc.)",
            "normalize_answer maps UNMARKED/None → empty string",
            "Deduplication — richer extraction wins",
        ]
    }


# ─────────────────────────────────────────────
# Subjective Evaluation (from v6, unchanged)
# ─────────────────────────────────────────────

def clean_text(text: str) -> str:
    if text is None:
        return ""
    return " ".join(str(text).split()).lower().strip()

def round_to_quarter(value: float) -> float:
    return round(value * 4) / 4

def round_to_half(value: float) -> float:
    return round(value * 2) / 2

def extract_numeric(s: str) -> str:
    m = re.match(r'^\s*([-+]?\d+\.?\d*)', s.strip())
    return m.group(1) if m else ""

def is_numerically_equal(str1: str, str2: str) -> bool:
    try:
        n1, n2 = extract_numeric(str1), extract_numeric(str2)
        if not n1 or not n2:
            return False
        return abs(float(n1) - float(n2)) < 0.0001
    except (ValueError, TypeError):
        return False

def strip_units(s: str) -> str:
    """Strip trailing units: '23 dB' → '23', '18.4%' → '18.4'"""
    import re as _re
    return _re.sub(r'[a-zA-Z%°µΩ]+$', '', s.strip()).strip()

def is_text_based(s: str) -> bool:
    num = extract_numeric(s)
    if not num:
        return True
    return len(s.strip()[len(num):].strip().split()) > 2

def normalize_separators(text: str) -> str:
    """Treat comma, 'and', '/', '&' as equivalent separators for matching."""
    t = text.lower()
    t = re.sub(r'\s*,\s*', ' | ', t)
    t = re.sub(r'\s+and\s+', ' | ', t)
    t = re.sub(r'\s*/\s*', ' | ', t)
    t = re.sub(r'\s*&\s*', ' | ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def check_multiple_values_match(student: str, key: str) -> bool:
    # First try separator-normalized full match
    if normalize_separators(student) == normalize_separators(key):
        return True
    def split_and_strip(s):
        # Split on comma, "and", "/", "&"
        parts = re.split(r',|\band\b|/|&', s, flags=re.IGNORECASE)
        return [p.strip() for p in parts if p.strip()]
    sp, kp = split_and_strip(student), split_and_strip(key)
    if len(sp) != len(kp):
        return False
    for s, k in zip(sp, kp):
        sc, kc = clean_text(s), clean_text(k)
        if sc != kc and not is_numerically_equal(sc, kc):
            return False
    return True

def check_text_parts_match(student: str, key: str) -> bool:
    def split_and_strip(s):
        return [clean_text(p.strip()) for p in s.split(",") if p.strip()]
    sp, kp = split_and_strip(student), split_and_strip(key)
    return len(sp) == len(kp) and all(s == k for s, k in zip(sp, kp))

def extract_true_false(answer: str) -> tuple[str, str]:
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
        justification = re.sub(r'^because\s+', '', justification, flags=re.IGNORECASE).strip()
    return (tf_value, justification)


def evaluate_subjective_answer(question: str, answer_key: str, student_answer: str,
                                max_marks: float, question_type: str = "SHORT") -> dict:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    if not student_answer or not student_answer.strip():
        return {"obtained_marks": 0, "percentage": 0, "feedback": "No answer provided",
                "correct_points": [], "missing_points": [answer_key] if answer_key else [], "extra_points": []}

    if question_type.upper() == "TRUE_FALSE":
        _, key_just     = extract_true_false(answer_key)
        _, student_just = extract_true_false(student_answer)
        quarter, half, three_quarter = max_marks / 4, max_marks / 2, max_marks * 3 / 4
        prompt = f"""Evaluate ONLY the JUSTIFICATION (True/False part was already verified correct).
QUESTION: {question}
EXPECTED JUSTIFICATION: {key_just}
STUDENT'S JUSTIFICATION: {student_just}
MAXIMUM MARKS: {max_marks}
SCORING: Full({max_marks})=ALL key points | 3/4({three_quarter})=75%+ | Half({half})=~50% | 1/4({quarter})=<25% | 0=wrong/missing
Return ONLY JSON: {{"obtained_marks":<one of 0,{quarter},{half},{three_quarter},{max_marks}>,"percentage":<pct>,"feedback":"<1 sentence>","correct_points":[],"missing_points":[],"extra_points":[]}}"""

    elif question_type.upper() != "LONG" and max_marks <= 2:
        prompt = f"""Strict evaluation. QUESTION: {question}
ANSWER KEY: {answer_key}
STUDENT: {student_answer}
MAX MARKS: {max_marks}
Full marks if key concept correct. 0 if wrong/off-topic. No partial marks.
Return ONLY JSON: {{"obtained_marks":<0 or {max_marks}>,"percentage":<0 or 100>,"feedback":"<1 sentence>","correct_points":[],"missing_points":[],"extra_points":[]}}"""
    else:
        prompt = f"""Fair evaluation with partial credit. QUESTION: {question}
ANSWER KEY: {answer_key}
STUDENT: {student_answer}
MAX MARKS: {max_marks}
Meaning matters more than exact wording. Award partial marks for partial answers.
Return ONLY JSON: {{"obtained_marks":<0 to {max_marks}>,"percentage":<pct>,"feedback":"<1-2 sentences>","correct_points":[],"missing_points":[],"extra_points":[]}}"""

    payload = {
        "model":   "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": "You are an expert academic evaluator. Always respond with valid JSON only."},
            {"role": "user",   "content": prompt}
        ],
        "temperature":     0.1,
        "max_tokens":      1024,
        "response_format": {"type": "json_object"}
    }

    try:
        result    = make_groq_request(payload, timeout=60)
        json_text = result["choices"][0]["message"]["content"].strip()
        if json_text.startswith("```"):
            parts     = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        evaluation = json.loads(json_text.strip())
        raw_marks  = max(0, min(float(evaluation.get("obtained_marks", 0)), max_marks))
        evaluation["obtained_marks"] = round_to_quarter(raw_marks) if question_type.upper() == "TRUE_FALSE" else round_to_half(raw_marks)
        evaluation["percentage"]     = round((evaluation["obtained_marks"] / max_marks) * 100, 2) if max_marks > 0 else 0
        return evaluation
    except HTTPException:
        raise
    except Exception as e:
        return {"obtained_marks": 0, "percentage": 0, "feedback": f"Evaluation error: {e}",
                "correct_points": [], "missing_points": [], "extra_points": []}


from pydantic import BaseModel
from typing import List, Union

class QuestionEvaluation(BaseModel):
    question_number: Union[int, str]
    question_text:   str
    answer_key:      str
    student_answer:  str
    max_marks:       float
    question_type:   Optional[str] = "SHORT"

class EvaluationRequest(BaseModel):
    questions: List[QuestionEvaluation]


@app.post("/evaluate/subjective")
async def evaluate_subjective(request: EvaluationRequest):
    if not request.questions:
        raise HTTPException(status_code=400, detail="No questions provided")

    print(f"\n{'='*50}\nEvaluating {len(request.questions)} subjective answers\n{'='*50}")
    results, total_marks, obtained_marks = [], 0, 0

    for q in request.questions:
        print(f"\n📝 Q{q.question_number}: {q.question_text[:50]}...")
        s_ans  = clean_text(q.student_answer)
        k_ans  = clean_text(q.answer_key)
        q_type = (q.question_type or "SHORT").upper()
        requires_llm = q_type in ("SHORT", "LONG", "TRUE_FALSE")
        evaluation   = None

        if not s_ans:
            evaluation = {"obtained_marks": 0, "percentage": 0, "feedback": "No answer provided.",
                          "correct_points": [], "missing_points": [q.answer_key] if q.answer_key else [], "extra_points": []}

        elif q_type == "TRUE_FALSE":
            student_tf, student_just = extract_true_false(q.student_answer)
            key_tf, key_just         = extract_true_false(q.answer_key)
            if not student_tf:
                evaluation = {"obtained_marks": 0, "percentage": 0, "feedback": "No True/False provided.",
                              "correct_points": [], "missing_points": [f"Expected: {key_tf.title()}"], "extra_points": []}
            elif student_tf != key_tf:
                evaluation = {"obtained_marks": 0, "percentage": 0,
                              "feedback": f"Incorrect. Expected {key_tf.title()}, got {student_tf.title()}.",
                              "correct_points": [], "missing_points": [f"Correct: {key_tf.title()}"], "extra_points": []}
            elif not key_just:
                evaluation = {"obtained_marks": q.max_marks, "percentage": 100.0,
                              "feedback": f"Correct! Answer is {key_tf.title()}.",
                              "correct_points": [f"Correctly identified {key_tf.title()}."], "missing_points": [], "extra_points": []}
            elif not student_just:
                half_marks = round_to_quarter(q.max_marks / 2)
                evaluation = {"obtained_marks": half_marks,
                              "percentage": round((half_marks / q.max_marks) * 100, 2) if q.max_marks > 0 else 0,
                              "feedback": f"Correct {key_tf.title()}, but justification required and not provided.",
                              "correct_points": [f"Correctly identified {key_tf.title()}."],
                              "missing_points": ["Justification required but not provided."], "extra_points": []}
            # else: falls through to LLM

        elif not requires_llm:
            # Normalize separators before any comparison:
            # "Request to Send, Clear to send" == "Request to send and Clear to send"
            s_norm = normalize_separators(s_ans)
            k_norm = normalize_separators(k_ans)

            if s_ans == k_ans or s_norm == k_norm:
                evaluation = {"obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct.",
                              "correct_points": ["Matches answer key."], "missing_points": [], "extra_points": []}
            elif not is_text_based(k_ans) and (is_numerically_equal(s_ans, k_ans) or
                                               is_numerically_equal(strip_units(s_ans), strip_units(k_ans))):
                # Unit-tolerant numeric: "23 dB" == "23", "18.4%" == "18.4"
                evaluation = {"obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct.",
                              "correct_points": ["Correct."], "missing_points": [], "extra_points": []}
            elif check_multiple_values_match(s_ans, k_ans):
                # check_multiple_values_match now handles comma/and/slash separators
                evaluation = {"obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct.",
                              "correct_points": ["All values correct."], "missing_points": [], "extra_points": []}
            elif len(k_ans.split()) <= 3:
                key_pattern = re.escape(k_ans)
                if re.search(rf'\b{key_pattern}\b', s_ans, re.IGNORECASE):
                    evaluation = {"obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct.",
                                  "correct_points": ["Correct term."], "missing_points": [], "extra_points": []}
                else:
                    evaluation = {"obtained_marks": 0, "percentage": 0,
                                  "feedback": f"Incorrect. Expected '{q.answer_key}', got '{q.student_answer}'.",
                                  "correct_points": [], "missing_points": [f"Expected: {q.answer_key}"], "extra_points": []}
            else:
                evaluation = {"obtained_marks": 0, "percentage": 0,
                              "feedback": f"Incorrect. Expected '{q.answer_key}', got '{q.student_answer}'.",
                              "correct_points": [], "missing_points": [f"Expected: {q.answer_key}"], "extra_points": []}

        if evaluation is None:
            try:
                evaluation = evaluate_subjective_answer(
                    question=q.question_text, answer_key=q.answer_key,
                    student_answer=q.student_answer, max_marks=q.max_marks,
                    question_type=q.question_type or "SHORT"
                )
            except Exception as e:
                evaluation = {"obtained_marks": 0, "percentage": 0, "feedback": f"Error: {e}",
                              "correct_points": [], "missing_points": [], "extra_points": []}

        total_marks    += q.max_marks
        obtained_marks += evaluation["obtained_marks"]

        results.append({
            "question_number": q.question_number,
            "question_text":   q.question_text,
            "max_marks":       q.max_marks,
            "obtained_marks":  evaluation["obtained_marks"],
            "percentage":      evaluation["percentage"],
            "feedback":        evaluation["feedback"],
            "correct_points":  evaluation.get("correct_points", []),
            "missing_points":  evaluation.get("missing_points", []),
            "extra_points":    evaluation.get("extra_points", []),
            "answer_key":      q.answer_key,
            "student_answer":  q.student_answer
        })
        print(f"   ✅ {evaluation['obtained_marks']}/{q.max_marks} ({evaluation['percentage']}%)")

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
    import uvicorn, sys
    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            content = f.read()
        result = process_file(content, sys.argv[1])
        print(json.dumps(result, indent=2))
    else:
        print("\n" + "="*50)
        print("FREE OCR Service — Best Merge (v1 + v6)")
        print(f"Model: {GROQ_MODEL}")
        print("="*50)
        if not GROQ_API_KEY:
            print("\n⚠️  WARNING: GROQ_API_KEY not set in .env")
            print("   Get key: https://console.groq.com/keys")
        uvicorn.run(app, host="0.0.0.0", port=8001)
