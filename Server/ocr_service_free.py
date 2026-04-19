"""
FREE OCR Service - Anti-Hallucination Version
Uses Groq Vision API (Llama 4 Scout)

CHANGES FROM PREVIOUS VERSION:
  - Completely rewritten build_main_prompt() with stronger anti-hallucination rules
  - New JSON schema: enrollment, q_no, student_ans (matches your target format)
  - post_process_question() updated to handle both old and new key names
  - Pattern self-check instruction built into prompt
  - "INCAPABLE" persona suppression for stronger zero-knowledge enforcement
  - Explicit MCQ mark detection rules (printed labels ≠ student answer)
  - "?" for uncertain enrollment digits instead of guessing
  - Absolute Prohibitions block for hard constraint enforcement

NEW IN THIS VERSION:
  - SPATIAL MARK SCAN: model scans pixel regions per option, not guesses from text
  - ANTI-HALLUCINATION GATE: STEP 6 self-check before JSON output
  - MAJORITY VOTING: extract_with_voting() runs 3 seeds, takes consensus answer
  - Seed removed from single-pass calls (locked-in hallucination problem)
  - MCQ student_ans format clarified: uppercase letter only (A/B/C/D)
  - Voting used automatically when first pass has suspicious low-confidence results
  - BRIDGE PRIORITY FIX: bridge questions tagged "_confidence=bridge" (score+100)
    so they always beat voted page results in dedup — bridge sees full cross-page
    context and is the ground truth for split questions

FEATURES:
  - Bridge images (40% overlap) for cross-page questions
  - Default: one vision call per PDF page (full); optional halves mode via OCR_PDF_PAGE_MODE
  - Smart TPM-aware rate limiting with exponential backoff
  - Question type hints from answer key
  - 300 DPI rendering for quality
  - Deduplication (richer extraction wins)
  - TRUE_FALSE justification handling
  - Fast-pass evaluation for exact/numeric matches
  - Strict mode for short answers, lenient for long answers
  - /ocr/extract-key endpoint for answer key extraction
  - normalize_answer() - handles all Groq output formats, never returns None
"""

import os
import io
import json
import math
import base64
import time
import re
import random
import requests
from pathlib import Path
from dotenv import load_dotenv
from collections import Counter

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from typing import Optional, List, Union
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image as PILImage
import pypdfium2 as pdfium
from pydantic import BaseModel

load_dotenv()

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

# Voting config — set OCR_VOTING_ENABLED=false in .env to disable (saves TPM)
# When enabled: 3 seeds are tried; majority answer wins per question.
# Low-confidence questions (all 3 disagree) get flagged for manual review.
VOTING_SEEDS = [42, 123, 7]


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in ("1", "true", "yes")


VOTING_ENABLED = _env_bool("OCR_VOTING_ENABLED", False)  # off by default to save TPM

# Min seconds between Groq request *starts*
RATE_LIMIT_DELAY = _env_float("OCR_GROQ_MIN_INTERVAL_SEC", 8.0)
# Extra sleep after each successful vision response
OCR_GROQ_POST_CALL_COOLDOWN_SEC = _env_float("OCR_GROQ_POST_CALL_COOLDOWN_SEC", 4.0)

MAX_RETRIES = max(1, int(_env_float("OCR_GROQ_MAX_RETRIES", 5)))
GROQ_MAX_OUTPUT_TOKENS = max(
    4096,
    min(32768, int(_env_float("OCR_GROQ_MAX_OUTPUT_TOKENS", 8192))),
)
OVERLAP_RATIO = 0.40  # 40% overlap for bridge images
RENDER_SCALE = 300 / 72  # 300 DPI for quality


def _env_str(name: str, default: str) -> str:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower()

last_api_call_time = 0

# Question type normalization map
QUESTION_TYPE_MAP = {
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


# ─────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────
app = FastAPI(title="Free OCR Service (Groq Vision) - Anti-Hallucination")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# Rate Limiting (Smart TPM-aware)
# ─────────────────────────────────────────────
def wait_for_rate_limit():
    global last_api_call_time
    now = time.time()
    elapsed = now - last_api_call_time
    if elapsed < RATE_LIMIT_DELAY:
        wait = RATE_LIMIT_DELAY - elapsed
        print(f"  Rate limiting: waiting {wait:.1f}s...")
        time.sleep(wait)
    last_api_call_time = time.time()


def calculate_tpm_wait_time(error_msg: str, attempt: int) -> float:
    """Calculate smart wait time based on TPM usage from error message."""
    used_match = re.search(r'Used\s+(\d+)', error_msg)
    limit_match = re.search(r'Limit\s+(\d+)', error_msg)

    if used_match and limit_match:
        used = int(used_match.group(1))
        limit = int(limit_match.group(1))
        usage_ratio = used / limit if limit > 0 else 1.0
        if usage_ratio > 0.9:
            base_wait = 45 + (usage_ratio - 0.9) * 150
        elif usage_ratio > 0.7:
            base_wait = 20 + (usage_ratio - 0.7) * 125
        else:
            base_wait = 10 + usage_ratio * 15
        print(f"  TPM usage: {used}/{limit} ({usage_ratio*100:.1f}%)")
    else:
        base_wait = 15 * (2 ** attempt)

    jitter = base_wait * 0.2 * (random.random() - 0.5)
    wait_time = min(base_wait + jitter, 180)
    return max(wait_time, 5)


def make_groq_request(payload: dict, timeout: int = 120) -> dict:
    """Make request to Groq API with smart retry logic."""
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    for attempt in range(MAX_RETRIES):
        wait_for_rate_limit()
        try:
            response = requests.post(GROQ_API_URL, headers=headers, json=payload, timeout=timeout)
            response.raise_for_status()
            return response.json()

        except requests.exceptions.HTTPError as e:
            error_msg = str(e)
            status_code = e.response.status_code if e.response is not None else 500
            try:
                error_msg = e.response.json().get("error", {}).get("message", str(e))
            except Exception:
                pass
            print(f"  Groq API error (status {status_code}): {error_msg[:200]}")

            if "rate limit" in error_msg.lower() or status_code == 429:
                wait_time = calculate_tpm_wait_time(error_msg, attempt)
                try:
                    ra = e.response.headers.get("Retry-After") if e.response is not None else None
                    if ra is not None:
                        wait_time = max(wait_time, float(ra))
                except (TypeError, ValueError):
                    pass
                if attempt < MAX_RETRIES - 1:
                    print(f"  Rate limited. Waiting {wait_time:.1f}s before retry {attempt+2}/{MAX_RETRIES}...")
                    time.sleep(wait_time)
                    continue
                raise HTTPException(status_code=429, detail=f"Rate limit exceeded after {MAX_RETRIES} retries.")
            raise HTTPException(status_code=500, detail=f"Groq API error: {error_msg}")

        except requests.exceptions.Timeout:
            if attempt < MAX_RETRIES - 1:
                print(f"  Request timeout. Retrying {attempt+2}/{MAX_RETRIES}...")
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
    """Convert PIL image to base64 string, resizing if needed."""
    max_size = 2048
    if max(image.size) > max_size:
        ratio = max_size / max(image.size)
        new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
        image = image.resize(new_size, PILImage.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="PNG", quality=95)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def create_bridge_image(page_a: PILImage.Image, page_b: PILImage.Image) -> PILImage.Image:
    """
    Stitch the bottom OVERLAP_RATIO of page_a with the top OVERLAP_RATIO of page_b.
    Creates a "bridge" image containing any question split across the page boundary.
    """
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
    print(f"    Bridge: {target_w}x{bridge.height} (bottom {crop_h_a}px + top {crop_h_b}px)")
    return bridge


def split_page_halves(page: PILImage.Image, header_buffer: int = 150) -> tuple:
    """
    Split a page into top half and bottom half for separate extraction.
    10% overlap between halves prevents data loss at the split boundary.
    """
    w, h = page.size
    split_point = h // 2
    overlap = int(h * 0.10)

    top = page.crop((0, 0, w, split_point + overlap))
    bottom = page.crop((0, split_point - overlap, w, h))

    print(f"    Split: top=0-{split_point + overlap}px, bottom={split_point - overlap}-{h}px (10% overlap)")
    return top, bottom


def pdf_to_images(pdf_bytes: bytes) -> tuple:
    """
    Convert PDF to:
      pages        - full-page PIL images (one per PDF page)
      bridge_pages - stitched boundary images (one per adjacent pair)
    """
    pages = []
    pdf = pdfium.PdfDocument(pdf_bytes)
    for page_num in range(len(pdf)):
        page = pdf[page_num]
        bitmap = page.render(scale=RENDER_SCALE)
        pil_img = bitmap.to_pil()
        pages.append(pil_img)
        print(f"    Page {page_num+1}: {pil_img.size[0]}x{pil_img.size[1]} px")

    bridge_pages = []
    for i in range(len(pages) - 1):
        print(f"    Creating bridge {i+1}<->{i+2}...")
        bridge_pages.append(create_bridge_image(pages[i], pages[i + 1]))

    return pages, bridge_pages


# ─────────────────────────────────────────────
# Answer Normalization
# ─────────────────────────────────────────────
_NO_ANSWER_STRINGS = {"unmarked", "none", "null", "n/a", "not marked", "not answered"}
_MCQ_CANCEL_TOKENS = (
    "cross", "crossed", "x", "cut", "cutted", "strike", "struck", "scratch",
    "scratched", "cancel", "cancelled", "wrong", "overwrite", "overwritten"
)
_MCQ_FINAL_TOKENS = (
    "final", "finally", "changed", "change", "corrected", "rewrite", "rewritten",
    "new", "updated", "clear"
)


def normalize_answer(raw_answer) -> str:
    """
    Convert any Answer value Groq returns into a clean string.
    Never returns None.
    Maps UNMARKED/None/null -> "".
    Preserves "-" (student explicitly skipped).
    MCQ: returns "A,C" format.
    """
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

    if ans == "-":
        return "-"

    if ans.lower() in _NO_ANSWER_STRINGS or ans == "":
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
        inner = ans[1:-1].strip().strip("'\"")
        return "" if inner.lower() in _NO_ANSWER_STRINGS else inner

    return ans


def extract_mcq_letters(answer_text: str) -> list:
    """
    Extract explicit MCQ choices from answer text safely.
    Only accepts standalone A/B/C/D tokens (not letters inside words).
    Prefers the final rewritten choice when cancellations are mentioned.
    """
    if not answer_text:
        return []

    text = str(answer_text).strip()
    if not text:
        return []

    quick = re.findall(r'(?<![A-Za-z0-9])[A-Da-d](?![A-Za-z0-9])', text)
    if re.fullmatch(r'\s*[\(\[]?[A-Da-d][\)\]]?\s*(?:[,/&\s]+\s*[\(\[]?[A-Da-d][\)\]]?\s*)*', text):
        out = []
        seen = set()
        for l in quick:
            u = l.upper()
            if u not in seen:
                seen.add(u)
                out.append(u)
        return out

    lowered = text.lower()
    if any(tok in lowered for tok in _MCQ_FINAL_TOKENS):
        tail = re.search(
            r'(?:final|finally|changed\s+to|change\s+to|corrected\s+to|rewritten\s+as|new|updated)\s*[:\-]?\s*[\(\[]?([A-Da-d])[\)\]]?',
            text,
            re.IGNORECASE
        )
        if tail:
            return [tail.group(1).upper()]

    matches = list(re.finditer(r'(?<![A-Za-z0-9])[A-Da-d](?![A-Za-z0-9])', text))
    kept = []
    for m in matches:
        letter = m.group(0).upper()
        left_ctx = text[max(0, m.start() - 24):m.start()].lower()
        right_ctx = text[m.end():min(len(text), m.end() + 24)].lower()
        around = f"{left_ctx} {right_ctx}"
        cancelled = any(tok in around for tok in _MCQ_CANCEL_TOKENS)
        if not cancelled:
            kept.append(letter)

    if kept:
        return [kept[-1]]

    if matches:
        return [matches[-1].group(0).upper()]
    return []


def normalize_question_type(raw_type: str) -> str:
    """Maps all Groq type variants to canonical types."""
    if not raw_type:
        return "MCQ"
    return QUESTION_TYPE_MAP.get(raw_type.upper().strip(), raw_type.upper().strip())


def parse_question_number(question_text: str):
    """Extract integer question number from question text."""
    if not question_text:
        return None
    text = question_text.strip()
    for pat in [r'^[Qq]\.?\s*(\d+)', r'^(\d+)\s*[\.\)\:\-]', r'^[Qq]uestion\s+(\d+)']:
        m = re.match(pat, text)
        if m:
            return int(m.group(1))
    return None


def _raw_question_type_string(q: dict) -> Optional[str]:
    """Non-empty type string from model JSON, if any."""
    for k in ("questionType", "question_type", "type"):
        if k not in q:
            continue
        v = q[k]
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        return s
    return None


def _raw_marks_value(q: dict):
    """Marks from model JSON if key present and usable (not null/blank)."""
    for k in ("marks", "max_marks", "maxMarks"):
        if k not in q:
            continue
        v = q[k]
        if v is None:
            continue
        if isinstance(v, str) and not str(v).strip():
            continue
        return v
    return None


def infer_marks_from_question_text(text: str) -> Optional[float]:
    """Best-effort marks from question stem."""
    if not text or not text.strip():
        return None
    t = text.strip()
    m = re.search(r'\(\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*marks?\s*\)', t, re.IGNORECASE)
    if m:
        try:
            a, b = float(m.group(1)), float(m.group(2))
            if b > 0:
                return round(a / b, 4)
        except (ValueError, ZeroDivisionError):
            pass
    m = re.search(r'\(\s*(\d+(?:\.\d+)?)\s*marks?\s*\)', t, re.IGNORECASE)
    if m:
        try:
            v = float(m.group(1))
            return v if v > 0 else None
        except ValueError:
            pass
    m = re.search(r'\b(\d+(?:\.\d+)?)\s*marks?\b', t, re.IGNORECASE)
    if m:
        try:
            v = float(m.group(1))
            return v if v > 0 else None
        except ValueError:
            pass
    return None


def infer_question_type_from_content(q: dict) -> Optional[str]:
    """When the model omits question_type, infer from text/layout."""
    text = (q.get("questionText") or "").strip()
    text_l = text.lower()
    opts = [x for x in (q.get("options") or []) if x and str(x).strip()]

    if re.search(r'\btrue\s+or\s+false\b', text_l) or re.search(r'\bt\s*/\s*f\b', text_l):
        return "TRUE_FALSE"
    if len(opts) >= 2:
        return "MCQ"
    if '......' in text or '…' in text or bool(re.search(r'_{3,}', text)):
        return "FILL_BLANK"
    wc = len(text.split())
    if wc > 45:
        return "LONG"
    if wc > 12:
        return "SHORT"
    return None


def coerce_positive_qno(val) -> Optional[int]:
    """Parse Groq's q_no / questionNumber into a positive int, or None if unusable."""
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, str):
        s = val.strip()
        if s.isdigit():
            n = int(s)
            return n if n > 0 else None
        try:
            f = float(s)
            if math.isfinite(f) and abs(f - round(f)) < 1e-9:
                n = int(round(f))
                return n if n > 0 else None
        except ValueError:
            pass
        return None
    try:
        if isinstance(val, float):
            if not math.isfinite(val):
                return None
            if abs(val - round(val)) > 1e-9:
                return None
        n = int(val)
        return n if n > 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def fix_uniform_q_numbers_in_batch(questions: list) -> None:
    """
    When the model returns the same q_no for every row in one API response,
    expand to a contiguous sequence starting at that number.
    """
    if len(questions) < 2:
        return
    nums = [q.get("questionNumber") for q in questions]
    if not nums or not all(n == nums[0] for n in nums):
        return
    k = nums[0]
    if k is None or k == 0:
        return
    for i, q in enumerate(questions):
        q["questionNumber"] = k + i
    print(
        f"  fix_uniform_q_numbers_in_batch: uniform q_no={k} → {k}..{k + len(questions) - 1} "
        f"({len(questions)} rows)"
    )


def normalize_groq_response_keys(q: dict) -> dict:
    """Normalize old/new JSON key names from Groq."""
    if not isinstance(q, dict):
        return {}
    out = dict(q)

    qnum = (
        coerce_positive_qno(q.get("questionNumber")) or
        coerce_positive_qno(q.get("q_no")) or
        coerce_positive_qno(q.get("question_number")) or
        coerce_positive_qno(q.get("qno"))
    )
    out["questionNumber"] = qnum

    out["questionText"] = (
        q.get("questionText") or
        q.get("text") or
        q.get("question_text") or
        q.get("question") or
        ""
    )

    rqt = _raw_question_type_string(q)
    out["_explicit_qt"] = rqt is not None
    out["questionType"] = rqt if rqt is not None else "MCQ"

    out["Answer"] = (
        q.get("student_ans") if q.get("student_ans") is not None else
        q.get("Answer") if q.get("Answer") is not None else
        q.get("answer") if q.get("answer") is not None else
        q.get("student_answer") if q.get("student_answer") is not None else
        None
    )

    rm = _raw_marks_value(q)
    out["_explicit_marks"] = rm is not None
    out["marks"] = rm

    out["options"] = (
        q.get("options") or
        q.get("choices") or
        []
    )

    return out


def normalize_groq_document_info(raw: dict) -> dict:
    """Normalize documentInfo from both old and new schema."""
    if "enrollment" in raw:
        enrollment = str(raw.get("enrollment", "0")).strip()
        return {
            "enrollmentNumber": enrollment if enrollment else "0",
            "date": raw.get("date", ""),
            "totalMarks": raw.get("totalMarks", 0)
        }

    doc_info = raw.get("documentInfo", {})
    return {
        "enrollmentNumber": str(doc_info.get("enrollmentNumber", "0")).strip() or "0",
        "date": doc_info.get("date", ""),
        "totalMarks": doc_info.get("totalMarks", 0)
    }


def post_process_question(q: dict, idx: int, question_types: dict = None) -> dict:
    """Apply all per-question normalizations after key-name normalization."""
    q = normalize_groq_response_keys(q)
    explicit_qt = q.pop("_explicit_qt", False)
    explicit_marks = q.pop("_explicit_marks", False)

    groq_num = q.get("questionNumber")
    text_num = parse_question_number(q.get("questionText", ""))
    cn = coerce_positive_qno(groq_num)
    if cn is not None:
        q["questionNumber"] = cn
    elif text_num is not None:
        q["questionNumber"] = text_num
    else:
        q["questionNumber"] = idx
        print(f"  Q{idx}: no question number found, using index {idx}")

    hinted_type = False
    if question_types:
        qnum_str = str(q.get("questionNumber"))
        hinted = question_types.get(qnum_str) or question_types.get(q.get("questionNumber"))
        if hinted:
            q["questionType"] = hinted
            hinted_type = True

    raw_marks = q.get("marks")
    if explicit_marks:
        if raw_marks is None:
            q["marks"] = 1.0
        else:
            marks_str = str(raw_marks).strip().replace("½", "0.5").replace("¼", "0.25")
            try:
                parsed_marks = float(marks_str)
                q["marks"] = parsed_marks if parsed_marks > 0 else 1.0
            except (ValueError, TypeError):
                q["marks"] = 1.0
                print(f"  Q{q.get('questionNumber', idx)}: could not parse marks={raw_marks!r}, defaulting to 1.0")
    else:
        inferred_m = infer_marks_from_question_text(q.get("questionText", ""))
        if inferred_m is not None:
            q["marks"] = inferred_m
        else:
            q["marks"] = 1.0

    q["questionType"] = normalize_question_type(q.get("questionType", "MCQ"))
    if not explicit_qt:
        inferred_t = infer_question_type_from_content(q)
        if inferred_t:
            q["questionType"] = inferred_t

    raw_ans = q.get("Answer")
    q["Answer"] = normalize_answer(raw_ans)

    if raw_ans == "-" or (isinstance(raw_ans, str) and raw_ans.strip() == "-"):
        q["Answer"] = "-"

    # ── DETECT HALLUCINATED PATTERNS (MCQ only) ───────────────────────
    if q["questionType"] == "MCQ" and q["Answer"]:
        ans = q["Answer"].strip().lower()
        hallucination_patterns = [
            "cbdac", "abcd", "abcdcba", "cbadcbad",
            "c,b,d,a", "a,b,c,d", "c,b,d,a,c", "a,b,c,d,a",
            "c,b,d,a,c,b,d,a", "a,b,c,d,a,b,c,d"
        ]
        if ans in hallucination_patterns:
            print(f"  Q{q.get('questionNumber')}: Detected hallucinated pattern '{ans}' → clearing to ''")
            q["Answer"] = ""
        elif re.match(r'^([a-d],?\s*){4,}$', ans):
            letters_only = re.sub(r'[^a-d]', '', ans)
            if len(letters_only) >= 4:
                if (letters_only == "abcd" * (len(letters_only) // 4) or
                        letters_only == "cbda" * (len(letters_only) // 4)):
                    print(f"  Q{q.get('questionNumber')}: Detected repeating pattern '{ans}' → clearing to ''")
                    q["Answer"] = ""

    # ── MCQ: Check for empty options → reclassify as FILL_BLANK ─────────
    if q["questionType"] == "MCQ":
        options = q.get("options", [])
        has_real_options = any(str(opt).strip() for opt in options) if options else False
        if not has_real_options:
            q["questionType"] = "FILL_BLANK"
            q["options"] = []
            print(f"  Q{q.get('questionNumber')}: No real options found, reclassified MCQ → FILL_BLANK")

    # ── MCQ: Map text answer to option letter ─────────────────────────────
    if q["questionType"] == "MCQ":
        ans = q.get("Answer", "").strip()
        options = q.get("options", [])

        if ans and ans != "-" and not re.fullmatch(r'[A-Da-d](?:,[A-Da-d])*', ans):
            ans_lower = ans.lower().strip()
            matched_letter = None

            for idx_opt, opt in enumerate(options):
                if idx_opt >= 4:
                    break
                opt_text = str(opt).strip()
                opt_clean = re.sub(r'^[\(\[]?[a-dA-D][\)\]\.\:\-]?\s*', '', opt_text).strip().lower()

                if ans_lower == opt_clean or opt_clean == ans_lower:
                    matched_letter = chr(65 + idx_opt)
                    break
                if ans_lower in opt_clean or opt_clean in ans_lower:
                    matched_letter = chr(65 + idx_opt)
                    break

            if matched_letter:
                print(f"  Q{q.get('questionNumber')}: Mapped text answer '{ans}' → '{matched_letter}'")
                q["Answer"] = matched_letter
            else:
                if not re.match(r'^[A-Da-d][\)\.\-\s]', ans):
                    q["questionType"] = "FILL_BLANK"
                    q["options"] = []

    # ── For MCQ: extract explicit option letters only ───────────────────
    if q["questionType"] == "MCQ" and q["Answer"] and q["Answer"] != "-":
        letters = extract_mcq_letters(q["Answer"])
        if letters:
            q["Answer"] = ",".join(letters)
        elif re.search(r'[A-Da-d]', q["Answer"]):
            q["Answer"] = ""

    # ── For TRUE_FALSE: normalize T/F but preserve justification exactly ─
    if q["questionType"] == "TRUE_FALSE" and q["Answer"] and q["Answer"] != "-":
        ans = q["Answer"].strip()
        tf_match = re.match(r'^(true|false|t|f)\b(.*)', ans, re.IGNORECASE | re.DOTALL)
        if tf_match:
            tf_part = tf_match.group(1).lower()
            remainder = tf_match.group(2)
            canonical = "True" if tf_part in ("true", "t") else "False"
            q["Answer"] = canonical + remainder

    if q.get("options") is None:
        q["options"] = []

    if q["questionType"] in ("SHORT", "LONG", "FILL_BLANK"):
        q["options"] = []

    if q.get("questionText") and q["questionType"] == "MCQ":
        text = q["questionText"]
        extracted_options = []

        option_patterns = [
            r'[\(\[]([a-dA-D])[\)\]]\s*([^(\[a-dA-D]+?)(?=[\(\[][a-dA-D][\)\]]|$)',
            r'\b([a-dA-D])[\)\.\:]\s*([^a-dA-D\)\.\:]+?)(?=\b[a-dA-D][\)\.\:]|$)',
            r'([A-Da-d])\)\s*([^A-Da-d\)\s]+?)(?=[A-Da-d]\)|$)',
        ]

        for pattern in option_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            if len(matches) >= 2:
                for letter, opt_text in matches:
                    opt_text = opt_text.strip()
                    if opt_text and len(opt_text) > 1:
                        extracted_options.append(f"{letter.upper()}) {opt_text}")

                if extracted_options:
                    first_opt_match = re.search(
                        r'[\(\[]?[a-dA-D][\)\]\.\:\)]\s*[^a-dA-D\)\.\:\)\s]', text, re.IGNORECASE
                    )
                    if first_opt_match:
                        q["questionText"] = text[:first_opt_match.start()].strip()

                    if len(extracted_options) >= 2:
                        q["options"] = extracted_options
                        print(f"  Q{q['questionNumber']}: Moved {len(extracted_options)} options from questionText to options list")
                    break

        if not extracted_options and re.search(r'[\(\[]?[a-dA-D][\)\]\.\:]', text, re.IGNORECASE):
            cleaned_text = re.sub(r'[\(\[]?[a-dA-D][\)\]\.\:]\s*[^a-dA-D\)\.\:\)\s]*', '', text, flags=re.IGNORECASE)
            q["questionText"] = cleaned_text.strip()

    if coerce_positive_qno(q.get("questionNumber")) is None:
        q["questionNumber"] = int(idx)

    opts_info = f", options={len(q['options'])}" if q['options'] else ""
    print(f"  Q{q['questionNumber']} [{q['questionType']}]: Answer={q['Answer']!r} (raw={raw_ans!r}){opts_info}")
    return q


def _richness_score_for_dedup(question: dict) -> int:
    score = 0
    opts = question.get("options") or []
    ans = question.get("Answer", "")
    text = question.get("questionText", "")
    score += len(opts) * 10
    score += len(text) // 50
    if ans and ans not in ("", "-", "[unreadable]"):
        score += 5
    elif ans == "-":
        score += 1
    if question.get("marks", 1.0) != 1.0:
        score += 3

    # Confidence bonus — priority order:
    #   bridge (100) > voted high (50) > voted low (10) > single-pass (0)
    #
    # Bridge always wins: it sees both pages stitched together and has the best
    # visual context for any question that spans a page boundary.
    # Voted "high" beats any single-pass result (including other bridges for the
    # same q_no that weren't bridge-sourced).
    confidence = question.get("_confidence", "")
    if confidence == "bridge":
        score += 100  # full cross-page visual context — ground truth for split questions
    elif confidence == "high":
        score += 50   # 2/3 or 3/3 seeds agreed
    elif confidence == "low":
        score += 10   # went through voting but all 3 disagreed

    return score


def _question_text_snippet(q: dict, max_len: int = 140) -> str:
    t = (q.get("questionText") or "").strip()
    if not t:
        return ""
    return " ".join(t.lower().split())[:max_len]


def post_process_questions(questions: list) -> list:
    """Deduplicate questions from overlapping page/bridge extractions."""
    for q in questions:
        if not isinstance(q, dict):
            continue
        if coerce_positive_qno(q.get("questionNumber")) is None:
            for alt in ("q_no", "question_number", "qno"):
                c = coerce_positive_qno(q.get(alt))
                if c is not None:
                    q["questionNumber"] = c
                    break

    by_num: dict = {}
    loose: list = []

    for q in questions:
        if not isinstance(q, dict):
            continue
        if q.get("options") is None:
            q["options"] = []
        qn = coerce_positive_qno(q.get("questionNumber"))
        if qn is None:
            loose.append(q)
            continue

        existing = by_num.get(qn)
        if existing is None:
            by_num[qn] = q
            continue

        ex_score = _richness_score_for_dedup(existing)
        nw_score = _richness_score_for_dedup(q)
        if nw_score > ex_score:
            by_num[qn] = q
        elif nw_score == ex_score:
            if len(q.get("Answer", "")) > len(existing.get("Answer", "")):
                by_num[qn] = q

    still_loose: list = []
    for q in loose:
        if not isinstance(q, dict):
            continue
        if q.get("options") is None:
            q["options"] = []
        tn = parse_question_number(q.get("questionText", ""))
        if tn is None or tn < 1:
            still_loose.append(q)
            continue
        existing = by_num.get(tn)
        if existing is None:
            by_num[tn] = q
        else:
            if _richness_score_for_dedup(q) > _richness_score_for_dedup(existing):
                by_num[tn] = q
            elif _richness_score_for_dedup(q) == _richness_score_for_dedup(existing):
                if len(q.get("Answer", "")) > len(existing.get("Answer", "")):
                    by_num[tn] = q

    merged = [by_num[k] for k in sorted(by_num.keys())]
    merged_snips = {_question_text_snippet(x) for x in merged}
    merged_snips.discard("")

    kept_loose: list = []
    for q in still_loose:
        if not isinstance(q, dict):
            continue
        sn = _question_text_snippet(q)
        if not sn:
            ans = (q.get("Answer") or "").strip()
            opts = q.get("options") or []
            if ans or (isinstance(opts, list) and len(opts) > 0):
                kept_loose.append(q)
            continue
        dup = False
        if sn in merged_snips:
            dup = True
        else:
            for ms in merged_snips:
                if len(sn) >= 50 and len(ms) >= 50 and (sn in ms or ms in sn):
                    dup = True
                    break
        if not dup:
            kept_loose.append(q)

    by_fp: dict = {}
    for q in kept_loose:
        fp = _question_text_snippet(q, max_len=200)
        if not fp:
            continue
        cur = by_fp.get(fp)
        if cur is None or _richness_score_for_dedup(q) > _richness_score_for_dedup(cur):
            by_fp[fp] = q

    loose_unique = list(by_fp.values())
    out = merged + loose_unique
    n_ids = len(set(id(x) for x in questions if isinstance(x, dict)))

    if len(out) == 0 and len(questions) > 0:
        print("  Dedup: no rows survived filters — fallback: assign q_no 1..N by raw order")
        fallback: list = []
        n = 0
        for q in questions:
            if not isinstance(q, dict):
                continue
            if q.get("options") is None:
                q["options"] = []
            n += 1
            if coerce_positive_qno(q.get("questionNumber")) is None:
                q["questionNumber"] = n
            fallback.append(q)
        out = fallback

    print(
        f"  Dedup: {len(merged)} by q_no + {len(loose_unique)} residual unnumbered "
        f"→ {len(out)} total (from {len(questions)} raw, {n_ids} dict ids)"
    )
    return out


# ─────────────────────────────────────────────
# String Comparison Utilities
# ─────────────────────────────────────────────
def strict_string_compare(student_answer: str, key_answer: str) -> bool:
    if not student_answer or not key_answer:
        return False
    s = " ".join(student_answer.strip().split())
    k = " ".join(key_answer.strip().split())
    return s.lower() == k.lower()


def semantic_contains_match(student_answer: str, key_answer: str) -> tuple:
    if not student_answer or not key_answer:
        return (False, "no_match")

    s = " ".join(student_answer.strip().split()).lower()
    k = " ".join(key_answer.strip().split()).lower()

    if s == k:
        return (True, "exact")
    if k in s:
        return (True, "contains_key")
    if s in k and len(s) >= 3:
        return (True, "key_contains_student")

    key_words = set(k.split())
    student_words = set(s.split())

    if len(key_words) <= 3:
        if key_words.issubset(student_words):
            return (True, "contains_key")
    else:
        common_words = key_words.intersection(student_words)
        stop_words = {'a', 'an', 'the', 'is', 'are', 'of', 'to', 'in', 'for', 'and', 'or'}
        significant_key_words = key_words - stop_words
        significant_common = common_words - stop_words
        if significant_key_words and len(significant_common) / len(significant_key_words) >= 0.7:
            return (True, "contains_key")

    k_dehyphen = k.replace("-", " ").replace("  ", " ")
    s_dehyphen = s.replace("-", " ").replace("  ", " ")
    if k_dehyphen == s_dehyphen:
        return (True, "exact")
    if k_dehyphen in s_dehyphen:
        return (True, "contains_key")

    return (False, "no_match")


def extract_core_term(answer: str) -> str:
    if not answer:
        return ""
    text = " ".join(answer.strip().split()).lower()
    fillers = [
        r'^the\s+', r'^a\s+', r'^an\s+',
        r'\s+is\s+', r'\s+are\s+', r'\s+the\s+',
        r'^it\s+is\s+', r'^this\s+is\s+',
    ]
    for filler in fillers:
        text = re.sub(filler, ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


# ─────────────────────────────────────────────
# Groq Prompts
# ─────────────────────────────────────────────
def build_main_prompt(num_pages: int, question_types: dict = None, crop_instruction: str = "") -> str:
    """Structured prompt for student answer sheet extraction."""
    qt_hints = ""
    if question_types:
        lines = ["KNOWN QUESTION TYPES FROM ANSWER KEY:"]
        for qnum in sorted(question_types.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
            lines.append(f"  Q{qnum} = {question_types[qnum]}")
        qt_hints = "\n".join(lines) + "\n"

    crop_block = f"PAGE CONTEXT: {crop_instruction.strip()}\n" if crop_instruction.strip() else ""

    return f"""═══════════════════════════════════════════════════════════════
   STUDENT ANSWER SHEET EXTRACTION
═══════════════════════════════════════════════════════════════

You are an OCR system extracting student answers from {num_pages} page(s).
You can ONLY read what is physically written - you have NO subject knowledge.
You are INCAPABLE of knowing correct answers. You can ONLY describe ink marks.
You have to always extract what is written in paper do not try to remember any answer.
i think you are extracting too nicely for answer key but when it comes to extraction for answer key it doen't give me the right extraction so if you are trying to remember any answer or something so do not that thing just extract text and ticked marked options with your 100% accuracy.


{crop_block}{qt_hints}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STEP 1: GRID-CHECK (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Process the document as a TABLE/GRID.
Count ALL question numbers in the "Q No." column.
Your JSON MUST contain ALL questions - NO SKIPPING.

If you see Q1-Q5 and Q7-Q15, you MUST find Q6!
Empty/blank answers still need a question object with student_ans = ""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 STEP 2: SPATIAL MARK SCAN — MCQ ANSWER DETECTION (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For EACH MCQ row, scan the ANSWER COLUMN ONLY — not the printed option text.

Scan each option region independently:
  [REGION A] = pixel area immediately left/right of printed "(a)" label
  [REGION B] = pixel area immediately left/right of printed "(b)" label
  [REGION C] = pixel area immediately left/right of printed "(c)" label
  [REGION D] = pixel area immediately left/right of printed "(d)" label

In each region, ask: Is there INK that was NOT part of the original printed paper?
  → Tick shape, oval/loop, underline stroke, or handwritten letter = YES → mark found
  → Clean white space or only printed text = NO → no mark here

Return the ONE letter whose region has extra ink.
If multiple regions have ink → pick the darkest/most prominent mark.
If ZERO regions have ink → student_ans = ""

VALID STUDENT MARKS (handwritten ink added by student):
  ✅ Tick (✓ or √) drawn on/near an option
  ✅ Circle or oval drawn around an option letter
  ✅ Underline drawn under an option
  ✅ Handwritten letter in the answer column (e.g., student wrote "C")

NOT A STUDENT MARK (ignore these completely):
  ❌ Printed "(a)", "(b)", "(c)", "(d)" labels — these exist on every paper
  ❌ The printed option text itself
  ❌ Crossed-out or cancelled marks

⚠️ DO NOT GUESS. DO NOT CREATE PATTERNS like "C,B,D,A" or "cbdac"
⚠️ If no ink mark is visible → student_ans = ""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 STEP 3: CROSSED-OUT / OVERWRITTEN ANSWERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If student crossed out an answer and wrote a NEW one:
  → Use the CLEAR/NEW answer (not the scratched one)
  → The final legible answer takes priority

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 STEP 4: OTHER QUESTION TYPES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILL_BLANK / SHORT / LONG:
  → Transcribe EXACT handwritten text (include units like "23 dB")
  → Do NOT correct spelling or complete sentences

TRUE_FALSE:
  → Return "True" or "False" + justification if written

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 STEP 5: ENROLLMENT NUMBER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the FULL enrollment number from the TOP of the page.
Capture ALL digits. Do NOT truncate.
If a digit is unreadable, use "?" for that digit.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  STEP 6: ANTI-HALLUCINATION GATE — MANDATORY SELF-CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before writing ANY MCQ answer into your JSON, ask yourself:
  "Did I SEE ink on this paper for this answer, or am I inferring it?"

If the answer is "inferring" or "it seems likely" → student_ans = ""
Only ink you can visually confirm goes into student_ans.

FORBIDDEN OUTPUT PATTERNS — if your MCQ answers match any of these, STOP and re-scan:
  ❌ All same letter:      "C, C, C, C, C, C"
  ❌ Neat rotation:        "A, B, C, D, A, B, C, D"
  ❌ Staircase pattern:    "A, B, C, D, C, B, A"
  ❌ All answered, none blank (real students always leave some blank)
  ❌ Any sequence that looks like known correct answers (you have NO subject knowledge)

If your output matches any forbidden pattern → clear ALL MCQ answers to "" and re-scan each one individually.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY this JSON structure (no explanation, no markdown):

{{
  "enrollment": "full enrollment number",
  "questions": [
    {{
      "q_no": <question number>,
      "text": "question text without options",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "student_ans": "student's answer - see rules below",
      "marks": <marks from sheet>,
      "question_type": "MCQ | FILL_BLANK | SHORT | LONG | TRUE_FALSE"
    }}
  ]
}}

STUDENT_ANS FIELD RULES:
  MCQ        → Single UPPERCASE letter only: A, B, C, or D
               Never return "a)", "(A)", or option text — only the bare letter
               Return "" if no ink mark found
  FILL_BLANK → Exact handwritten text including units (e.g. "23 dBm")
  SHORT/LONG → Exact handwritten text
  TRUE_FALSE → "True" or "False" + justification if written
  Blank      → ""
  Dash       → "-"

  If answer is blank:
→ DOUBLE CHECK the region again before returning empty
→ Zoom mentally into the answer box
→ Look for faint or partial marks

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ FINAL CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Did I include ALL questions from the sheet?
□ For MCQs: Did I scan each region for actual INK, not guess from question text?
□ Did I run the ANTI-HALLUCINATION GATE check on my MCQ answers?
□ For crossed-out answers: Did I use the CLEAR/NEW answer?
□ Did I read the FULL enrollment number?

═══════════════════════════════════════════════════════════════
Return ONLY valid JSON. No explanation text.
═══════════════════════════════════════════════════════════════"""


def build_answer_key_prompt(num_pages: int) -> str:
    """Build high-precision extraction prompt for answer keys."""
    return f"""═══════════════════════════════════════════════════════════════
   STRICT AUDITOR MODE - ANSWER KEY EXTRACTION
═══════════════════════════════════════════════════════════════

SYSTEM PERSONA: You are a STRICT VISUAL AUDITOR for ANSWER KEY extraction.
Your job is to extract EVERY question with COMPLETE information including ALL MCQ options.

⚠️ You are processing an ANSWER KEY, NOT a student sheet.
⚠️ The Answer field = the PRINTED CORRECT VALUE from the key.

Analyze these {num_pages} page(s) of an ANSWER KEY or MODEL ANSWER document.
Extract EVERY question with its CORRECT/MODEL answer.

Return a JSON object with EXACTLY this structure:
{{
  "enrollment": "0",
  "questions": [
    {{
      "q_no": <integer question number>,
      "text": "Complete question text WITHOUT the options.",
      "question_type": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <maximum marks allocated for this question>,
      "options": ["A) full option text", "B) full option text", "C) full option text", "D) full option text"],
      "student_ans": "FULL TEXT of correct answer - PRINTED value from key"
    }}
  ]
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STEP 1: GRID-CHECK EXTRACTION (MANDATORY TABLE PROCESSING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST process the document as a TABLE/GRID.
Use the "Q No." column as a MANDATORY CHECKLIST.

GRID-CHECK RULE:
If the answer key shows question numbers 1 through 15, your JSON output
MUST contain EXACTLY 15 question objects. NO EXCEPTIONS.

DO NOT skip a row because:
  - The answer looks empty
  - The text is partially visible
  - You're unsure about the content

⚠️ SKIPPING ROWS LIKE Q4 OR Q6 IS A CRITICAL FAILURE ⚠️

COUNTING VERIFICATION:
Step 1: Count ALL question numbers in the "Q No." column (1, 2, 3, 4, 5, 6... 15)
Step 2: If you see Q1-Q5 and Q7-Q15, you MUST go back and find Q6!
Step 3: Compare: Does len(questions) == number of rows in table?
Step 4: If mismatch, RE-SCAN the document!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 STEP 2: MCQ OPTION CAPTURE (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For EVERY MCQ question, you MUST extract the FULL TEXT of ALL options
(A, B, C, D) into the "options" array.

⚠️ NEVER leave the options array empty for an MCQ! ⚠️

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STEP 3: MARKS EXTRACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Capture the MAXIMUM MARKS allocated for each question.
Look for: [2], (2), "2 marks", [5], (5), [0.5], (½), etc.
Do NOT default to 1 if you can see a different value!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STEP 4: ANSWER FIELD - FULL TEXT REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The student_ans field must contain the FULL TEXT of the correct answer
as PRINTED in the answer key.

For MCQ:
  ❌ WRONG: "B"
  ✅ RIGHT: "B) Paris" or "Paris"

For SHORT/FILL_BLANK:
  ❌ WRONG: abbreviated or partial text
  ✅ RIGHT: complete answer as written in the key

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ FINAL CHECKLIST (VERIFY BEFORE RETURNING):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ GRID-CHECK: Does my question count match ALL rows in the answer key?
□ NO SKIPS: Did I include EVERY question?
□ OPTIONS: Did I populate the "options" array for ALL MCQ questions?
□ FULL TEXT: Does each student_ans field contain FULL TEXT?
□ MARKS: Did I read marks from the document, not default to 1?

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT: Return ONLY valid JSON - no explanation text.
═══════════════════════════════════════════════════════════════"""


def build_bridge_prompt() -> str:
    """Build extraction prompt for bridge images."""
    return """You are an expert exam paper OCR system analyzing a BRIDGE IMAGE.
This image shows the BOTTOM of one exam page stitched with the TOP of the next page.
Extract ONLY questions that span the boundary (question text on one half, options/answer on the other).

Return a JSON object:
{
  "enrollment": "0",
  "questions": [
    {
      "q_no": <integer>,
      "text": "Full question text",
      "question_type": "MCQ or SHORT or LONG or TRUE_FALSE or FILL_BLANK",
      "marks": <marks>,
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "student_ans": "student's answer"
    }
  ]
}

CROSS-PAGE RULE: If MCQ options (A/B/C/D) appear at the top of the lower half,
they belong to the question in the upper half. Combine into one complete MCQ.

Return ONLY valid JSON - no explanation text."""


# ─────────────────────────────────────────────
# Core Extraction
# ─────────────────────────────────────────────
def extract_with_groq(images: list, is_bridge: bool = False, is_answer_key: bool = False,
                      question_types: dict = None, crop_instruction: str = "",
                      seed: int = None) -> dict:
    """
    Extract questions from images using Groq Vision API.

    seed: Optional int. When provided, passed to Groq for reproducibility.
          In production single-pass mode, leave as None (avoids locking in hallucinations).
          In voting mode, different seeds are passed per attempt to get variation.
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured.")

    image_contents = [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_to_base64(img)}"}}
        for img in images
    ]

    if is_bridge:
        prompt = build_bridge_prompt()
        if crop_instruction.strip():
            prompt = crop_instruction.strip() + "\n\n" + prompt
        label = "BRIDGE"
    elif is_answer_key:
        prompt = build_answer_key_prompt(len(images))
        label = f"ANSWER KEY {len(images)} page(s)"
    else:
        prompt = build_main_prompt(len(images), question_types, crop_instruction=crop_instruction)
        label = f"{len(images)} page(s)"

    content = image_contents + [{"type": "text", "text": prompt}]

    payload = {
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.0,       # CRITICAL: deterministic, literal transcription
        "max_tokens": GROQ_MAX_OUTPUT_TOKENS,
        "response_format": {"type": "json_object"}
    }

    # Only add seed when explicitly requested (voting mode).
    # In normal single-pass mode we omit it — a locked-in hallucination is worse
    # than slight run-to-run variance.
    if seed is not None:
        payload["seed"] = seed

    print(f"\n{'='*60}")
    seed_info = f", seed={seed}" if seed is not None else ""
    print(f"Sending {label} to Groq Vision... (max_tokens={GROQ_MAX_OUTPUT_TOKENS}{seed_info})")
    print(f"{'='*60}")

    try:
        result = make_groq_request(payload, timeout=120)
        ch0 = result["choices"][0]
        finish = ch0.get("finish_reason")
        if finish == "length":
            print(
                "\n  ⚠️  Groq finish_reason=length — output may be truncated. "
                "Raise OCR_GROQ_MAX_OUTPUT_TOKENS in .env.\n"
            )
        json_text = ch0["message"]["content"]

        print(f"\nRAW RESPONSE (first 1500 chars):\n{'-'*40}")
        print(json_text[:1500])
        print(f"{'-'*40}\n")

        json_text = json_text.strip()
        if json_text.startswith("```"):
            parts = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        json_text = json_text.strip()

        parsed = json.loads(json_text)

        doc_info = normalize_groq_document_info(parsed)

        _ql = parsed.get("questions", [])
        questions_raw = [dict(x) for x in _ql if isinstance(x, dict)]

        for idx, q in enumerate(questions_raw, start=1):
            questions_raw[idx - 1] = post_process_question(q, idx, question_types=question_types)

        fix_uniform_q_numbers_in_batch(questions_raw)

        num_q = len(questions_raw)
        print(f"Extracted {num_q} questions from {label}")

        if image_contents and OCR_GROQ_POST_CALL_COOLDOWN_SEC > 0:
            time.sleep(OCR_GROQ_POST_CALL_COOLDOWN_SEC)

        return {"documentInfo": doc_info, "questions": questions_raw}

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
# Majority Voting (Anti-Hallucination)
# ─────────────────────────────────────────────
def _has_suspicious_answers(questions: list) -> bool:
    """
    Returns True if the extraction looks like it may contain hallucinated MCQ answers.
    Triggers: all MCQs answered (no blanks), or obvious rotation/repeat patterns.
    """
    mcq_answers = [
        q.get("Answer", "") for q in questions
        if q.get("questionType") == "MCQ"
    ]
    if not mcq_answers:
        return False

    # All MCQs answered with no blanks is suspicious for dense answer sheets
    if len(mcq_answers) >= 5 and all(a for a in mcq_answers):
        print("  Voting trigger: all MCQs answered, no blanks — may be hallucinated")
        return True

    # Check for repeating rotation pattern (A,B,C,D,A,B,C,D...)
    non_empty = [a for a in mcq_answers if a]
    if len(non_empty) >= 4:
        pattern = "".join(non_empty)
        if pattern == "ABCD" * (len(pattern) // 4) or pattern == "DCBA" * (len(pattern) // 4):
            print(f"  Voting trigger: rotation pattern detected '{pattern}'")
            return True

    return False


def extract_with_voting(images: list, is_bridge: bool = False, is_answer_key: bool = False,
                        question_types: dict = None, crop_instruction: str = "") -> dict:
    """
    Run extraction N times with different seeds, take majority answer per question.

    - 3 seeds tried (VOTING_SEEDS)
    - Per question: answer that appears in 2+ runs wins
    - If all 3 runs disagree: confidence="low", flagged for manual review
    - Richer metadata (options, marks, text) taken from the run with highest richness score
    - Enrollment number: taken from first run that returns a non-"0" value

    TPM cost: 3× the normal single-pass cost.
    Enable with OCR_VOTING_ENABLED=true in .env, or call directly.
    """
    print(f"\n  VOTING MODE: running {len(VOTING_SEEDS)} seeds {VOTING_SEEDS}...")
    all_runs = []
    doc_info = {"enrollmentNumber": "0", "date": "", "totalMarks": 0}

    for seed in VOTING_SEEDS:
        try:
            result = extract_with_groq(
                images, is_bridge=is_bridge, is_answer_key=is_answer_key,
                question_types=question_types, crop_instruction=crop_instruction,
                seed=seed
            )
            # Capture first valid enrollment
            run_doc = result.get("documentInfo", {})
            if run_doc.get("enrollmentNumber") and run_doc["enrollmentNumber"] != "0":
                if doc_info["enrollmentNumber"] == "0":
                    doc_info = run_doc

            all_runs.append(result.get("questions", []))
            print(f"  Seed {seed}: {len(all_runs[-1])} questions extracted")
        except Exception as e:
            print(f"  Seed {seed} failed: {e}")
            all_runs.append([])

    if not any(all_runs):
        raise HTTPException(status_code=500, detail="All voting runs failed")

    # Build per-question answer pools
    # Key: questionNumber, Value: dict with answer lists and richest question object
    by_qno: dict = {}

    for run in all_runs:
        for q in run:
            qno = coerce_positive_qno(q.get("questionNumber"))
            if qno is None:
                continue
            if qno not in by_qno:
                by_qno[qno] = {"answers": [], "best_q": q}
            else:
                # Keep richest question object for metadata
                if _richness_score_for_dedup(q) > _richness_score_for_dedup(by_qno[qno]["best_q"]):
                    by_qno[qno]["best_q"] = q
            by_qno[qno]["answers"].append(q.get("Answer", ""))

    final_questions = []
    low_confidence_count = 0

    for qno in sorted(by_qno.keys()):
        entry = by_qno[qno]
        answers = entry["answers"]
        best_q = dict(entry["best_q"])

        vote_counts = Counter(answers)
        most_common_ans, count = vote_counts.most_common(1)[0]

        if count >= 2:
            # Majority agreement (2 or 3 out of 3 runs)
            best_q["Answer"] = most_common_ans
            best_q["_confidence"] = "high"
            confidence_label = f"{count}/{len(VOTING_SEEDS)} agree"
        else:
            # All 3 runs disagreed — flag for manual review
            best_q["Answer"] = most_common_ans  # best guess = first in count
            best_q["_confidence"] = "low"
            best_q["_vote_detail"] = answers
            confidence_label = f"LOW — votes: {answers}"
            low_confidence_count += 1

        print(f"  Q{qno}: votes={answers} → '{most_common_ans}' ({confidence_label})")
        final_questions.append(best_q)

    if low_confidence_count > 0:
        print(f"\n  ⚠️  {low_confidence_count} question(s) have low confidence — manual review recommended")

    print(f"  Voting complete: {len(final_questions)} questions, {low_confidence_count} low-confidence")
    return {"documentInfo": doc_info, "questions": final_questions}


# ─────────────────────────────────────────────
# File Processing
# ─────────────────────────────────────────────
def _do_extract(images, is_bridge=False, is_answer_key=False,
                question_types=None, crop_instruction="",
                force_voting=False) -> dict:
    """
    Smart extraction wrapper.
    - If VOTING_ENABLED or force_voting: always use voting
    - Otherwise: single pass; if suspicious answers detected, re-run with voting
    """
    if VOTING_ENABLED or force_voting:
        return extract_with_voting(
            images, is_bridge=is_bridge, is_answer_key=is_answer_key,
            question_types=question_types, crop_instruction=crop_instruction
        )

    # Single pass (default — saves TPM)
    result = extract_with_groq(
        images, is_bridge=is_bridge, is_answer_key=is_answer_key,
        question_types=question_types, crop_instruction=crop_instruction
        # No seed — avoids locking in hallucinations across runs
    )

    # Auto-escalate to voting if answers look suspicious
    if not is_answer_key and _has_suspicious_answers(result.get("questions", [])):
        print("\n  ⚠️  Suspicious answers detected — escalating to voting mode...")
        return extract_with_voting(
            images, is_bridge=is_bridge, is_answer_key=is_answer_key,
            question_types=question_types, crop_instruction=crop_instruction
        )

    return result


def process_file(file_bytes: bytes, filename: str, is_answer_key: bool = False,
                 question_types: dict = None, force_voting: bool = False) -> dict:
    """Process a file (PDF or image) and extract questions."""
    ext = Path(filename).suffix.lower()
    mode_label = "ANSWER KEY" if is_answer_key else "STUDENT SHEET"

    if ext == ".pdf":
        print(f"Processing PDF ({mode_label}): {filename}")
        pages, bridge_pages = pdf_to_images(file_bytes)
        print(f"  Found {len(pages)} page(s), {len(bridge_pages)} bridge image(s)")

        doc_info = {"enrollmentNumber": "0", "date": "", "totalMarks": 0}
        all_questions = []

        if len(pages) <= 10:
            pdf_mode = _env_str("OCR_PDF_PAGE_MODE", "full")
            if pdf_mode not in ("full", "halves"):
                pdf_mode = "full"

            if pdf_mode == "full":
                print(f"  PDF layout: full-page mode. Set OCR_PDF_PAGE_MODE=halves for split crops.")
                for page_idx, page in enumerate(pages):
                    print(f"\n  Processing page {page_idx + 1}/{len(pages)} [{mode_label}] (full page)...")
                    crop = ""
                    if not is_answer_key:
                        crop = (
                            f"Full-page image of the student answer sheet — page {page_idx + 1} of {len(pages)}. "
                            "Extract EVERY row from the Q No. / question table on this page. "
                            "Each q_no must match the printed question number exactly. Do not skip rows."
                        )
                    elif is_answer_key:
                        crop = (
                            f"Full page {page_idx + 1} of {len(pages)} of an ANSWER KEY or question paper. "
                            "Extract every numbered question; q_no must match the document."
                        )
                    try:
                        result = _do_extract([page], is_bridge=False,
                                             is_answer_key=is_answer_key,
                                             question_types=question_types,
                                             crop_instruction=crop,
                                             force_voting=force_voting)
                        page_doc_info = result.get("documentInfo", {})
                        if page_doc_info.get("enrollmentNumber") and page_doc_info["enrollmentNumber"] != "0":
                            if doc_info["enrollmentNumber"] == "0":
                                doc_info = page_doc_info
                        pqs = result.get("questions", [])
                        print(f"     Page {page_idx + 1} FULL -> {len(pqs)} question(s)")
                        all_questions.extend(pqs)
                    except Exception as e:
                        print(f"  Page {page_idx + 1} full-page failed: {e}")
            else:
                print("  PDF layout: halves mode (TOP+BOTTOM+half-bridge per page).")
                for page_idx, page in enumerate(pages):
                    print(f"\n  Processing page {page_idx + 1}/{len(pages)} [{mode_label}]...")

                    top_half, bottom_half = split_page_halves(page)
                    page_qs = []

                    for half_label, half_img in [("TOP", top_half), ("BOTTOM", bottom_half)]:
                        try:
                            crop = ""
                            if not is_answer_key:
                                p = page_idx + 1
                                if half_label == "TOP":
                                    crop = (
                                        f"This is the UPPER crop of exam page {p}. "
                                        "Read the printed Q No. column and set q_no to those exact integers. "
                                        "Different rows MUST have different q_no."
                                    )
                                else:
                                    crop = (
                                        f"This is the LOWER crop of exam page {p}. "
                                        "The Q No. column may show higher numbers (e.g. 9–15). Copy those exact values. "
                                        "Do NOT restart every row at q_no: 1."
                                    )
                            result = _do_extract([half_img], is_bridge=False,
                                                 is_answer_key=is_answer_key,
                                                 question_types=question_types,
                                                 crop_instruction=crop,
                                                 force_voting=force_voting)
                            page_doc_info = result.get("documentInfo", {})
                            if page_doc_info.get("enrollmentNumber") and page_doc_info["enrollmentNumber"] != "0":
                                if doc_info["enrollmentNumber"] == "0":
                                    doc_info = page_doc_info
                            half_qs = result.get("questions", [])
                            print(f"     Page {page_idx + 1} {half_label} -> {len(half_qs)} question(s)")
                            page_qs.extend(half_qs)
                        except Exception as e:
                            print(f"  Page {page_idx + 1} {half_label} failed: {e}")

                    try:
                        print(f"    Creating half-bridge for page {page_idx + 1}...")
                        half_bridge = create_bridge_image(top_half, bottom_half)
                        hb_crop = ""
                        if not is_answer_key:
                            hb_crop = (
                                f"Stitched strip: bottom of UPPER crop + top of LOWER crop on page {page_idx + 1}. "
                                "Extract only rows split across that internal fold; use printed Q No. exactly."
                            )
                        result = _do_extract([half_bridge], is_bridge=True,
                                             is_answer_key=is_answer_key,
                                             question_types=question_types,
                                             crop_instruction=hb_crop,
                                             force_voting=force_voting)
                        half_bridge_qs = result.get("questions", [])
                        print(f"     Page {page_idx + 1} HALF-BRIDGE -> {len(half_bridge_qs)} question(s)")
                        page_qs.extend(half_bridge_qs)
                    except Exception as e:
                        print(f"  Page {page_idx + 1} HALF-BRIDGE failed: {e}")

                    all_questions.extend(page_qs)
        else:
            print(f"  Large PDF ({len(pages)} pages) - processing in batches of 5...")
            for i in range(0, len(pages), 5):
                batch = pages[i:i + 5]
                print(f"\n  Processing pages {i+1}-{i+len(batch)} [{mode_label}]...")
                try:
                    result = _do_extract(batch, is_bridge=False,
                                         is_answer_key=is_answer_key,
                                         question_types=question_types,
                                         force_voting=force_voting)
                    page_doc_info = result.get("documentInfo", {})
                    if page_doc_info.get("enrollmentNumber") and page_doc_info["enrollmentNumber"] != "0":
                        if doc_info["enrollmentNumber"] == "0":
                            doc_info = page_doc_info
                    batch_qs = result.get("questions", [])
                    print(f"     Batch -> {len(batch_qs)} question(s)")
                    all_questions.extend(batch_qs)
                except Exception as e:
                    print(f"  Batch {i+1}-{i+len(batch)} failed: {e}")

        if not is_answer_key:
            for i, bridge in enumerate(bridge_pages):
                print(f"\n  Processing bridge {i+1}<->{i+2}...")
                try:
                    br_crop = (
                        f"Bridge image: bottom of page {i + 1} stitched with top of page {i + 2}. "
                        "Set q_no from the printed Q No. column; each distinct row needs its own q_no."
                    )
                    # Never vote on bridge — bridge already has full cross-page visual
                    # context (both pages stitched). Voting page crops for the same
                    # q_no is unreliable because the model can't see the complete question.
                    result = _do_extract([bridge], is_bridge=True,
                                         is_answer_key=False,
                                         question_types=question_types,
                                         crop_instruction=br_crop,
                                         force_voting=False)
                    bridge_qs = result.get("questions", [])
                    # Tag as bridge so dedup gives them score+100 — always beats
                    # voted page results for the same question number.
                    for q in bridge_qs:
                        q["_confidence"] = "bridge"
                    print(f"     Bridge -> {len(bridge_qs)} question(s) [tagged as bridge]")
                    all_questions.extend(bridge_qs)
                except Exception as e:
                    print(f"  Bridge {i+1}<->{i+2} failed (non-fatal): {e}")

        deduped = post_process_questions(all_questions)
        print(f"\n  Total after dedup: {len(deduped)} questions (from {len(all_questions)} raw)")
        return {"documentInfo": doc_info, "questions": deduped}

    elif ext in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"):
        print(f"Processing image ({mode_label}): {filename}")
        image = PILImage.open(io.BytesIO(file_bytes)).convert("RGB")
        return _do_extract([image], is_answer_key=is_answer_key, question_types=question_types, force_voting=force_voting)

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")


# ─────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────
@app.post("/ocr/extract")
async def extract_from_file(
    file: UploadFile = File(...),
    question_types: Optional[str] = Form(None),
    force_voting: bool = Form(False)
):
    """Extract from STUDENT ANSWER SHEET."""
    file_bytes = await file.read()

    qt_map = {}
    if question_types:
        try:
            qt_map = json.loads(question_types)
            print(f"Question type hints received: {qt_map}")
        except Exception as e:
            print(f"Could not parse question_types: {e}")

    print(f"\n{'='*50}\nProcessing STUDENT SHEET: {file.filename}")
    extraction = process_file(
        file_bytes,
        file.filename,
        is_answer_key=False,
        question_types=qt_map,
        force_voting=force_voting
    )
    num_q = len(extraction.get("questions", []))
    print(f"FINAL: {num_q} questions\n{'='*50}\n")
    return JSONResponse(content={
        "success": True,
        "extraction": extraction,
        "filename": file.filename
    })


@app.post("/ocr/extract-key")
async def extract_answer_key(file: UploadFile = File(...)):
    """Extract from ANSWER KEY / QUESTION PAPER."""
    content = await file.read()
    print(f"\n{'='*50}\nProcessing ANSWER KEY: {file.filename}")
    extraction = process_file(content, file.filename, is_answer_key=True)
    num_q = len(extraction.get("questions", []))
    print(f"FINAL: {num_q} questions\n{'='*50}\n")
    return JSONResponse(content={
        "success": True,
        "extraction": extraction,
        "filename": file.filename
    })


@app.get("/health")
async def health():
    return {
        "status": "healthy" if GROQ_API_KEY else "needs_api_key",
        "model": GROQ_MODEL,
        "groq_min_interval_sec": RATE_LIMIT_DELAY,
        "groq_post_vision_cooldown_sec": OCR_GROQ_POST_CALL_COOLDOWN_SEC,
        "groq_max_retries": MAX_RETRIES,
        "groq_max_output_tokens": GROQ_MAX_OUTPUT_TOKENS,
        "pdf_page_mode": _env_str("OCR_PDF_PAGE_MODE", "full"),
        "voting_enabled": VOTING_ENABLED,
        "voting_seeds": VOTING_SEEDS,
        "version": "anti-hallucination-v2",
        "features": [
            "Spatial mark scan prompt (region-by-region ink detection)",
            "Anti-hallucination gate (STEP 6 self-check in prompt)",
            "Majority voting with auto-escalation on suspicious answers",
            "No seed in single-pass mode (avoids locked-in hallucinations)",
            "MCQ student_ans format clarified: uppercase letter only",
            "INCAPABLE persona — zero subject knowledge enforcement",
            "Bridge images (40% overlap) for cross-page questions",
            "Smart TPM-aware rate limiting",
            "Question type hints from answer key",
            "300 DPI rendering",
            "Deduplication - richer extraction wins",
            "Backward-compatible key normalization (old + new schema)",
        ]
    }


# ─────────────────────────────────────────────
# Evaluation Helper Functions
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


def is_numerically_equal(str1: str, str2: str, tolerance: float = 0.0001) -> bool:
    try:
        n1, n2 = extract_numeric(str1), extract_numeric(str2)
        if not n1 or not n2:
            return False
        return abs(float(n1) - float(n2)) < tolerance
    except (ValueError, TypeError):
        return False


def is_numerically_close(str1: str, str2: str, tolerance_percent: float = 5.0) -> bool:
    try:
        n1, n2 = extract_numeric(str1), extract_numeric(str2)
        if not n1 or not n2:
            return False
        v1, v2 = float(n1), float(n2)
        if v2 == 0:
            return v1 == 0
        percent_diff = abs(v1 - v2) / abs(v2) * 100
        return percent_diff <= tolerance_percent
    except (ValueError, TypeError):
        return False


def strip_units(s: str) -> str:
    return re.sub(r'[a-zA-Z%]+$', '', s.strip()).strip()


def is_text_based(s: str) -> bool:
    num = extract_numeric(s)
    if not num:
        return True
    return len(s.strip()[len(num):].strip().split()) > 2


def normalize_separators(text: str) -> str:
    t = text.lower()
    t = re.sub(r'\s*,\s*', ' | ', t)
    t = re.sub(r'\s+and\s+', ' | ', t)
    t = re.sub(r'\s*/\s*', ' | ', t)
    t = re.sub(r'\s*&\s*', ' | ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def check_multiple_values_match(student: str, key: str) -> bool:
    if normalize_separators(student) == normalize_separators(key):
        return True

    def split_and_strip(s):
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
        return [clean_text(p.strip()) for p in s.split(',') if p.strip()]
    sp, kp = split_and_strip(student), split_and_strip(key)
    return len(sp) == len(kp) and all(s == k for s, k in zip(sp, kp))


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
        justification = re.sub(r'^because\s+', '', justification, flags=re.IGNORECASE).strip()
    return (tf_value, justification)


def is_short_specific_answer(answer_key: str) -> bool:
    k = clean_text(answer_key)
    word_count = len(k.split())
    has_abbreviation = bool(re.search(r'\b[A-Z]{2,}\b', answer_key))
    is_numeric = bool(re.match(r'^[\d\.\-\s]+[a-zA-Z%]*$', k))
    return word_count <= 10 or is_numeric or has_abbreviation


# ─────────────────────────────────────────────
# Subjective Evaluation
# ─────────────────────────────────────────────
def evaluate_subjective_answer(question: str, answer_key: str, student_answer: str,
                               max_marks: float, question_type: str = "SHORT") -> dict:
    """Use Groq LLM to evaluate a subjective answer."""
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    if not student_answer or not student_answer.strip():
        return {
            "obtained_marks": 0, "percentage": 0, "feedback": "No answer provided",
            "correct_points": [], "missing_points": [answer_key] if answer_key else [], "extra_points": []
        }

    if question_type.upper() == "TRUE_FALSE":
        _, key_just = extract_true_false(answer_key)
        _, student_just = extract_true_false(student_answer)
        if key_just:
            quarter, half = max_marks / 4, max_marks / 2
            three_quarter = max_marks * 3 / 4
            prompt = f"""Evaluate ONLY the JUSTIFICATION (True/False part was already verified correct).
QUESTION: {question}
EXPECTED JUSTIFICATION: {key_just}
STUDENT'S JUSTIFICATION: {student_just}
MAXIMUM MARKS: {max_marks}
SCORING: Full({max_marks})=ALL key points | 3/4({three_quarter})=75%+ | Half({half})=~50% | 1/4({quarter})=<25% | 0=wrong/missing
Return ONLY JSON: {{"obtained_marks":<one of 0,{quarter},{half},{three_quarter},{max_marks}>,"percentage":<pct>,"feedback":"<1 sentence>","correct_points":[],"missing_points":[],"extra_points":[]}}"""
        else:
            return {
                "obtained_marks": max_marks, "percentage": 100.0,
                "feedback": "Correct True/False answer.",
                "correct_points": ["Correct."], "missing_points": [], "extra_points": []
            }
    elif question_type.upper() != "LONG" and max_marks <= 2:
        prompt = f"""SEMANTIC EVALUATION for short answer.
QUESTION: {question}
ANSWER KEY: {answer_key}
STUDENT ANSWER: {student_answer}
MAX MARKS: {max_marks}

MATCHING RULES (IMPORTANT):
1. If student answer CONTAINS the key term, mark as CORRECT even if extra words added.
2. If student answer is semantically equivalent, mark as CORRECT.
3. If core technical term matches, award full marks.
4. Only mark WRONG if the answer is factually incorrect or completely off-topic.

Award {max_marks} if key concept is present (even with extra words).
Award 0 only if wrong/off-topic.
Return ONLY JSON: {{"obtained_marks":<0 or {max_marks}>,"percentage":<0 or 100>,"feedback":"<1 sentence>","correct_points":[],"missing_points":[],"extra_points":[]}}"""
    else:
        prompt = f"""SEMANTIC EVALUATION with partial credit.
QUESTION: {question}
ANSWER KEY: {answer_key}
STUDENT ANSWER: {student_answer}
MAX MARKS: {max_marks}

MATCHING RULES:
1. Meaning matters more than exact wording.
2. Award credit if student includes key concepts, even with extra explanation.
3. Award partial marks for partial answers.
4. Only deduct marks for missing key points, not for extra correct information.

Return ONLY JSON: {{"obtained_marks":<0 to {max_marks}>,"percentage":<pct>,"feedback":"<1-2 sentences>","correct_points":[],"missing_points":[],"extra_points":[]}}"""

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": "You are an expert academic evaluator. Always respond with valid JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"}
    }

    try:
        result = make_groq_request(payload, timeout=60)
        json_text = result["choices"][0]["message"]["content"].strip()
        if json_text.startswith("```"):
            parts = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        evaluation = json.loads(json_text.strip())
        raw_marks = max(0, min(float(evaluation.get("obtained_marks", 0)), max_marks))
        if question_type.upper() == "TRUE_FALSE":
            evaluation["obtained_marks"] = round_to_quarter(raw_marks)
        else:
            evaluation["obtained_marks"] = round_to_half(raw_marks)
        evaluation["percentage"] = round((evaluation["obtained_marks"] / max_marks) * 100, 2) if max_marks > 0 else 0
        return evaluation
    except HTTPException:
        raise
    except Exception as e:
        return {
            "obtained_marks": 0, "percentage": 0, "feedback": f"Evaluation error: {e}",
            "correct_points": [], "missing_points": [], "extra_points": []
        }


# ─────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────
class QuestionEvaluation(BaseModel):
    question_number: Union[int, str]
    question_text: str
    answer_key: str
    student_answer: str
    max_marks: float
    question_type: Optional[str] = "SHORT"


class EvaluationRequest(BaseModel):
    questions: List[QuestionEvaluation]


class BulkEvaluationRequest(BaseModel):
    enrollment_number: str
    questions: List[QuestionEvaluation]


# ─────────────────────────────────────────────
# Evaluation Endpoint
# ─────────────────────────────────────────────
@app.post("/evaluate/subjective")
async def evaluate_subjective(request: EvaluationRequest):
    """Evaluate multiple subjective answers with fast-pass + LLM fallback."""
    if not request.questions:
        raise HTTPException(status_code=400, detail="No questions provided")

    print(f"\n{'='*50}\nEvaluating {len(request.questions)} subjective answers\n{'='*50}")
    results, total_marks, obtained_marks = [], 0, 0

    for q in request.questions:
        print(f"\nQ{q.question_number}: {q.question_text[:50]}...")

        s_ans = clean_text(q.student_answer)
        k_ans = clean_text(q.answer_key)
        q_type = (q.question_type or "SHORT").upper()
        evaluation = None

        if not s_ans:
            evaluation = {
                "obtained_marks": 0, "percentage": 0, "feedback": "No answer provided.",
                "correct_points": [], "missing_points": [q.answer_key] if q.answer_key else [], "extra_points": []
            }
            print(f"   Fast: No answer provided")

        elif s_ans == k_ans:
            evaluation = {
                "obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Exact match - correct.",
                "correct_points": ["Matches answer key exactly."], "missing_points": [], "extra_points": []
            }
            print(f"   Fast: Exact match")

        elif q_type == "TRUE_FALSE":
            student_tf, student_just = extract_true_false(q.student_answer)
            key_tf, key_just = extract_true_false(q.answer_key)
            if not student_tf:
                evaluation = {
                    "obtained_marks": 0, "percentage": 0, "feedback": "No True/False provided.",
                    "correct_points": [], "missing_points": [f"Expected: {key_tf.title()}"], "extra_points": []
                }
            elif student_tf != key_tf:
                evaluation = {
                    "obtained_marks": 0, "percentage": 0,
                    "feedback": f"Incorrect. Expected {key_tf.title()}, got {student_tf.title()}.",
                    "correct_points": [], "missing_points": [f"Correct: {key_tf.title()}"], "extra_points": []
                }
            elif not key_just:
                evaluation = {
                    "obtained_marks": q.max_marks, "percentage": 100.0,
                    "feedback": f"Correct! Answer is {key_tf.title()}.",
                    "correct_points": [f"Correctly identified {key_tf.title()}."], "missing_points": [], "extra_points": []
                }
            elif not student_just:
                half_marks = round_to_quarter(q.max_marks / 2)
                evaluation = {
                    "obtained_marks": half_marks,
                    "percentage": round((half_marks / q.max_marks) * 100, 2) if q.max_marks > 0 else 0,
                    "feedback": f"Correct {key_tf.title()}, but justification required.",
                    "correct_points": [f"Correctly identified {key_tf.title()}."],
                    "missing_points": ["Justification required."], "extra_points": []
                }

        if evaluation is None and not is_text_based(k_ans) and is_numerically_equal(s_ans, k_ans):
            evaluation = {
                "obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct numerical value.",
                "correct_points": ["Correct value."], "missing_points": [], "extra_points": []
            }
            print(f"   Fast: Numerical match ({s_ans} = {k_ans})")

        if evaluation is None and not is_text_based(k_ans):
            if is_numerically_equal(strip_units(s_ans), strip_units(k_ans)):
                evaluation = {
                    "obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct value.",
                    "correct_points": ["Correct."], "missing_points": [], "extra_points": []
                }
                print(f"   Fast: Numeric match (units stripped)")

        if evaluation is None and not is_text_based(k_ans):
            if is_numerically_close(strip_units(s_ans), strip_units(k_ans), tolerance_percent=5.0):
                evaluation = {
                    "obtained_marks": q.max_marks, "percentage": 100.0,
                    "feedback": "Correct value (within acceptable tolerance).",
                    "correct_points": ["Value within acceptable range."], "missing_points": [], "extra_points": []
                }
                print(f"   Fast: Numeric match (5% tolerance)")

        if evaluation is None and ',' in k_ans:
            if normalize_separators(s_ans) == normalize_separators(k_ans):
                evaluation = {
                    "obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "All values correct.",
                    "correct_points": ["All values match."], "missing_points": [], "extra_points": []
                }
                print(f"   Fast: Separator-normalized match")
            elif check_multiple_values_match(s_ans, k_ans):
                evaluation = {
                    "obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "All values correct.",
                    "correct_points": ["All values match."], "missing_points": [], "extra_points": []
                }
                print(f"   Fast: Multiple values match")

        if evaluation is None:
            is_match, match_type = semantic_contains_match(q.student_answer, q.answer_key)
            if is_match:
                feedback = {
                    "exact": "Correct answer.",
                    "contains_key": "Correct - answer contains the key term.",
                }.get(match_type, "Correct - core term identified.")
                evaluation = {
                    "obtained_marks": q.max_marks, "percentage": 100.0, "feedback": feedback,
                    "correct_points": ["Key term correctly identified."], "missing_points": [], "extra_points": []
                }
                print(f"   Fast: Semantic match ({match_type})")

        if evaluation is None and q.max_marks <= 1 and len(k_ans.split()) <= 3:
            key_pattern = re.escape(k_ans)
            if re.search(rf'\b{key_pattern}\b', s_ans, re.IGNORECASE):
                evaluation = {
                    "obtained_marks": q.max_marks, "percentage": 100.0, "feedback": "Correct answer.",
                    "correct_points": ["Correct term."], "missing_points": [], "extra_points": []
                }
                print(f"   Fast: Short term match")
            elif len(k_ans) <= 10:
                evaluation = {
                    "obtained_marks": 0, "percentage": 0,
                    "feedback": f"Incorrect. Expected '{q.answer_key}', got '{q.student_answer}'.",
                    "correct_points": [], "missing_points": [f"Expected: {q.answer_key}"], "extra_points": []
                }
                print(f"   Fast: Short term mismatch")

        if evaluation is None:
            mode = "STRICT" if (q.max_marks <= 1 or is_short_specific_answer(q.answer_key)) else "LENIENT"
            print(f"   LLM ({mode} mode)...")
            try:
                evaluation = evaluate_subjective_answer(
                    question=q.question_text, answer_key=q.answer_key,
                    student_answer=q.student_answer, max_marks=q.max_marks,
                    question_type=q.question_type or "SHORT"
                )
            except Exception as e:
                print(f"   LLM Error: {str(e)}")
                evaluation = {
                    "obtained_marks": 0, "percentage": 0, "feedback": f"Evaluation error: {str(e)}",
                    "correct_points": [], "missing_points": [], "extra_points": []
                }

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
            "extra_points": evaluation.get("extra_points", []),
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
    import sys

    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            content = f.read()
        result = process_file(content, sys.argv[1])
        print(json.dumps(result, indent=2))
    else:
        print("\n" + "="*50)
        print("FREE OCR Service - Anti-Hallucination v2")
        print(f"Model: {GROQ_MODEL}")
        print(f"Voting: {'ENABLED' if VOTING_ENABLED else 'AUTO (escalates on suspicious answers)'}")
        print(f"Voting seeds: {VOTING_SEEDS}")
        print(
            f"Groq pacing: min {RATE_LIMIT_DELAY}s between calls, "
            f"+{OCR_GROQ_POST_CALL_COOLDOWN_SEC}s after each vision response"
        )
        print(f"Groq max output tokens: {GROQ_MAX_OUTPUT_TOKENS}")
        print("="*50)
        print("New in v2:")
        print("  - Spatial mark scan: region-by-region ink detection in prompt")
        print("  - Anti-hallucination gate: STEP 6 self-check before JSON output")
        print("  - Majority voting: 3 seeds, consensus answer wins")
        print("  - Auto-escalation: voting triggered when suspicious patterns detected")
        print("  - No seed in single-pass (avoids locked-in hallucinations)")
        print("  - MCQ answer: uppercase letter only, never option text")
        print("="*50)
        print(".env options:")
        print("  OCR_VOTING_ENABLED=true       # always use voting (3x TPM cost)")
        print("  OCR_GROQ_MIN_INTERVAL_SEC=8   # rate limit between calls")
        print("  OCR_GROQ_POST_CALL_COOLDOWN_SEC=4")
        print("  OCR_GROQ_MAX_OUTPUT_TOKENS=8192")
        print("  OCR_PDF_PAGE_MODE=full        # or 'halves'")
        print("="*50)

        if not GROQ_API_KEY:
            print("\nWARNING: GROQ_API_KEY not set in .env")
            print("Get key: https://console.groq.com/keys")

        uvicorn.run(app, host="0.0.0.0", port=8001)
