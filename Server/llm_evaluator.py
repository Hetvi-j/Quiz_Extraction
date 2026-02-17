"""
LLM-based Subjective Answer Evaluator using Groq API.

Evaluates subjective (SHORT/LONG) answers by comparing student responses
against the answer key using LLM reasoning. Supports both direct evaluation
and RAG-enhanced evaluation when reference material is provided.

Runs as a FastAPI service alongside ocr_service_free.py.
"""

import os
import json
import requests
from typing import Optional, List, Dict, Any
from pathlib import Path
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    # dotenv not available or .env missing — continue using environment
    pass

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import re
import unicodedata
import difflib

# Optional fast fuzzy lib
try:
    from rapidfuzz import fuzz
    _HAS_RAPIDFUZZ = True
except Exception:
    fuzz = None
    _HAS_RAPIDFUZZ = False


def _normalize_text(s: str) -> str:
    if s is None:
        return ""
    s = str(s)
    s = unicodedata.normalize("NFKD", s)
    s = s.strip().lower()
    # convert common number words to digits (small set)
    num_words = {
        'zero': '0','one': '1','two': '2','three': '3','four': '4','five': '5',
        'six': '6','seven': '7','eight': '8','nine': '9','ten': '10'
    }
    def _word_to_num(match):
        w = match.group(0)
        return num_words.get(w, w)
    s = re.sub(r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\b", _word_to_num, s)
    # remove most punctuation but keep decimal points and minus
    s = re.sub(r"[^\w\s\.-]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _is_number(s: str):
    try:
        float(s)
        return True
    except Exception:
        return False


def _numeric_similarity(a: str, b: str, rel_tol: float = 1e-2) -> bool:
    try:
        return abs(float(a) - float(b)) <= max(rel_tol * max(abs(float(a)), abs(float(b))), rel_tol)
    except Exception:
        return False


def _similarity(a: str, b: str) -> float:
    """Return similarity in range 0..1 between two strings using rapidfuzz if present, else difflib."""
    if a is None or b is None:
        return 0.0
    a = a.strip()
    b = b.strip()
    if a == b:
        return 1.0
    if _HAS_RAPIDFUZZ:
        try:
            # token_sort_ratio returns 0..100
            return fuzz.token_sort_ratio(a, b) / 100.0
        except Exception:
            pass
    # fallback
    return difflib.SequenceMatcher(None, a, b).ratio()

# --- Configuration ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_EVAL_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

# --- FastAPI Setup ---
app = FastAPI(title="LLM Subjective Answer Evaluator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request/Response Models ---

class QuestionEvalRequest(BaseModel):
    questionText: str
    questionType: str  # SHORT, LONG, FILL_BLANK, MCQ, TRUE_FALSE
    marks: int = 1
    correctAnswer: str  # Answer key / model answer
    studentAnswer: str  # Student's response
    referenceContext: Optional[str] = None  # Optional RAG context for enhanced evaluation


class BulkEvalRequest(BaseModel):
    questions: List[Dict[str, Any]]

class EvalResult(BaseModel):
    questionNumber: int
    questionText: str
    questionType: str
    maxMarks: int
    obtainedMarks: float
    isCorrect: bool
    isPartial: bool
    feedback: str  # LLM-generated explanation of grading
    keyPoints: List[str]  # Key points the student covered
    missedPoints: List[str]  # Key points the student missed
    confidence: float  # LLM's confidence in the grading (0-1)


# --- Core Evaluation Logic ---

def evaluate_objective(question: dict) -> dict:
    """
    Evaluate objective questions (MCQ, TRUE_FALSE, FILL_BLANK).
    Uses tolerant comparisons for FILL_BLANK and TRUE_FALSE (fuzzy/numeric),
    while keeping MCQ behavior (with partial credit for multi-answer MCQs).
    No LLM needed for these.
    """
    correct_raw = str(question.get("correctAnswer", "")).strip()
    student_raw = str(question.get("studentAnswer", "")).strip()
    marks = question.get("marks", 1)
    qtype = question.get("questionType", "MCQ").upper()

    if qtype == "MCQ":
        # Handle multi-answer MCQs (e.g., "A,C" vs "A,C")
        correct_set = set(c.strip() for c in correct_raw.split(","))
        student_set = set(s.strip() for s in student_raw.split(","))

        if correct_set == student_set:
            return {
                "obtainedMarks": marks,
                "isCorrect": True,
                "isPartial": False,
                "feedback": "Correct answer.",
                "keyPoints": [f"Selected: {student_raw}"],
                "missedPoints": [],
                "confidence": 1.0
            }
        elif student_set & correct_set:
            # Partial credit for multi-answer MCQs
            overlap = len(student_set & correct_set)
            total = len(correct_set)
            partial_marks = round((overlap / total) * marks, 2)
            return {
                "obtainedMarks": partial_marks,
                "isCorrect": False,
                "isPartial": True,
                "feedback": f"Partially correct. Got {overlap}/{total} correct options.",
                "keyPoints": [f"Correct selections: {', '.join(student_set & correct_set)}"],
                "missedPoints": [f"Missed: {', '.join(correct_set - student_set)}"],
                "confidence": 1.0
            }
        else:
            return {
                "obtainedMarks": 0,
                "isCorrect": False,
                "isPartial": False,
                "feedback": f"Incorrect. Expected: {correct_raw}, Got: {student_raw}",
                "keyPoints": [],
                "missedPoints": [f"Correct answer was: {correct_raw}"],
                "confidence": 1.0
            }

    elif qtype == "TRUE_FALSE":
        # Accept common variants: true/false, yes/no, t/f
        corr = _normalize_text(correct_raw)
        stud = _normalize_text(student_raw)
        # map to canonical 'true' or 'false' if possible
        true_set = {"true", "t", "yes", "y", "1"}
        false_set = {"false", "f", "no", "n", "0"}

        if stud in true_set or stud in false_set:
            is_correct = (stud in true_set and corr in true_set) or (stud in false_set and corr in false_set)
        else:
            # fallback to fuzzy equality
            is_correct = _similarity(corr, stud) >= 0.9

        return {
            "obtainedMarks": marks if is_correct else 0,
            "isCorrect": is_correct,
            "isPartial": False,
            "feedback": "Correct." if is_correct else f"Incorrect. The answer is {correct_raw}.",
            "keyPoints": [student_raw] if is_correct else [],
            "missedPoints": [] if is_correct else [f"Correct answer: {correct_raw}"],
            "confidence": 1.0
        }

    elif qtype == "FILL_BLANK":
        corr = _normalize_text(correct_raw)
        stud = _normalize_text(student_raw)
        # If both are numeric, compare numerically with tolerance
        if _is_number(corr) and _is_number(stud):
            numeric_match = _numeric_similarity(corr, stud)
            if numeric_match:
                return {
                    "obtainedMarks": marks,
                    "isCorrect": True,
                    "isPartial": False,
                    "feedback": "Numeric answer within tolerance.",
                    "keyPoints": [student_raw],
                    "missedPoints": [],
                    "confidence": 1.0
                }
            else:
                # give partial proportional to closeness
                try:
                    a = float(corr)
                    b = float(stud)
                    ratio = max(0.0, 1.0 - abs(a - b) / (abs(a) + 1e-9))
                    partial_marks = round(ratio * marks, 2)
                except Exception:
                    partial_marks = 0
                return {
                    "obtainedMarks": partial_marks,
                    "isCorrect": partial_marks >= marks,
                    "isPartial": 0 < partial_marks < marks,
                    "feedback": "Numeric answer partially correct." if partial_marks > 0 else f"Incorrect. Expected: {correct_raw}",
                    "keyPoints": [student_raw] if partial_marks > 0 else [],
                    "missedPoints": [] if partial_marks > 0 else [f"Expected: {correct_raw}"],
                    "confidence": 1.0
                }

        # Non-numeric: use fuzzy similarity with thresholds
        sim = _similarity(corr, stud)
        if sim >= 0.75:
            return {
                "obtainedMarks": marks,
                "isCorrect": True,
                "isPartial": False,
                "feedback": "Correct.",
                "keyPoints": [student_raw],
                "missedPoints": [],
                "confidence": 1.0
            }
        elif sim >= 0.50:
            partial_marks = round(sim * marks, 2)
            return {
                "obtainedMarks": partial_marks,
                "isCorrect": False,
                "isPartial": True,
                "feedback": f"Partially correct (similarity {sim:.2f}).",
                "keyPoints": [student_raw],
                "missedPoints": [f"Expected: {correct_raw}"],
                "confidence": 0.8
            }
        else:
            return {
                "obtainedMarks": 0,
                "isCorrect": False,
                "isPartial": False,
                "feedback": f"Incorrect. Expected: {question.get('correctAnswer', '')}",
                "keyPoints": [],
                "missedPoints": [f"Expected: {question.get('correctAnswer', '')}"],
                "confidence": 0.9 if sim < 0.5 else 0.6
            }

    return {
        "obtainedMarks": 0,
        "isCorrect": False,
        "isPartial": False,
        "feedback": "Unknown question type.",
        "keyPoints": [],
        "missedPoints": [],
        "confidence": 0.0
    }


def evaluate_subjective_with_llm(questions: List[Dict]) -> List[Dict]:

    """
    Evaluate subjective (SHORT/LONG) answers using Groq LLM.
    Batches multiple questions into a single LLM call for efficiency.
    """
    # If GROQ API key is missing, fall back to a local heuristic evaluator
    if not GROQ_API_KEY:
        print("GROQ_API_KEY not found — using local heuristic evaluator (fallback).")
        # Heuristic: normalize and compute similarity for each question
        evals = []
        for i, q in enumerate(questions):
            corr = _normalize_text(q.get("correctAnswer", ""))
            stud = _normalize_text(q.get("studentAnswer", ""))
            marks = q.get("marks", 1)
            # DEBUG: log what we're comparing
            print(f"  [Q{i+1}] Raw key: '{q.get('correctAnswer', '')}' | Raw student: '{q.get('studentAnswer', '')}'")
            print(f"  [Q{i+1}] Normalized key: '{corr}' | Normalized student: '{stud}'")

            # numeric handling
            if _is_number(corr) and _is_number(stud):
                if _numeric_similarity(corr, stud):
                    obtained = marks
                    feedback = "Numeric answer within tolerance."
                    confidence = 0.95
                else:
                    try:
                        a = float(corr); b = float(stud)
                        ratio = max(0.0, 1.0 - abs(a - b) / (abs(a) + 1e-9))
                        obtained = round(ratio * marks, 2)
                        feedback = f"Numeric answer partially correct (score {obtained}/{marks})."
                        confidence = 0.7
                    except Exception:
                        obtained = 0
                        feedback = "Numeric mismatch."
                        confidence = 0.5
            else:
                sim = _similarity(corr, stud)
                print(f"  [Q{i+1}] Similarity score: {sim:.3f} (threshold: 0.75 for full, 0.50 for partial)")
                if sim >= 0.75:
                    obtained = marks
                    feedback = "Answer matches model answer (heuristic)."
                    confidence = 0.9
                elif sim >= 0.50:
                    obtained = round(sim * marks, 2)
                    feedback = f"Partially correct (heuristic similarity {sim:.2f})."
                    confidence = 0.7
                else:
                    obtained = 0
                    feedback = "Answer does not match the model answer (heuristic)."
                    confidence = 0.4

            evals.append({
                "questionNumber": i + 1,
                "obtainedMarks": min(obtained, marks),
                "feedback": feedback,
                "keyPointsCovered": [],
                "keyPointsMissed": [],
                "confidence": confidence
            })

        return evals

    # Build the evaluation prompt
    questions_text = ""
    for i, q in enumerate(questions):
        ref_context = ""
        if q.get("referenceContext"):
            ref_context = f"\n  Reference Material: {q['referenceContext']}"

        questions_text += f"""
  Question {i + 1}:
  - Question: {q['questionText']}
  - Type: {q['questionType']}
  - Max Marks: {q['marks']}
  - Model Answer (Answer Key): {q['correctAnswer']}{ref_context}
  - Student Answer: {q['studentAnswer']}
"""

    prompt = f"""You are an expert academic evaluator. Evaluate the following student answers against the provided answer key / model answers.

For each question, you must:
1. Compare the student's answer with the model answer
2. Identify key points covered and missed
3. Award marks fairly based on correctness, completeness, and understanding shown
4. Provide brief, constructive feedback

GRADING GUIDELINES:
- Full marks: Answer covers all key points from the model answer with correct understanding
- Partial marks: Answer covers some key points but misses others, or has minor inaccuracies
- Zero marks: Answer is completely wrong, irrelevant, or blank
- For SHORT answers (1-5 marks): Focus on key concepts and definitions
- For LONG answers (5+ marks): Evaluate depth, examples, structure, and completeness
- Be fair but strict: reward understanding even if wording differs from the model answer
- If student uses different but correct terminology, give full credit
- If student provides extra correct information beyond model answer, acknowledge it

QUESTIONS TO EVALUATE:
{questions_text}

Return a JSON object with this EXACT structure:
{{
  "evaluations": [
    {{
      "questionNumber": 1,
      "obtainedMarks": <number between 0 and maxMarks, can be decimal like 2.5>,
      "feedback": "Brief explanation of grading decision (1-3 sentences)",
      "keyPointsCovered": ["point 1 student got right", "point 2 student got right"],
      "keyPointsMissed": ["point student missed or got wrong"],
      "confidence": <number between 0.0 and 1.0 indicating grading confidence>
    }}
  ]
}}

IMPORTANT:
- obtainedMarks MUST be between 0 and the maxMarks for that question
- Be consistent and fair across all questions
- Provide specific feedback, not generic comments
- Return ONLY valid JSON, no explanation outside the JSON"""

    payload = {
        "model": GROQ_EVAL_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are a fair and thorough academic answer evaluator. You grade subjective answers by comparing them against model answers. You always return valid JSON."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.1,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"}
    }

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        print(f"Evaluating {len(questions)} subjective question(s) with LLM...")
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=120
        )
        response.raise_for_status()

        result = response.json()
        json_text = result["choices"][0]["message"]["content"].strip()

        # Clean up response
        if json_text.startswith("```"):
            parts = json_text.split("```")
            json_text = parts[1] if len(parts) > 1 else parts[0]
            if json_text.startswith("json"):
                json_text = json_text[4:]
        json_text = json_text.strip()

        parsed = json.loads(json_text)
        return parsed.get("evaluations", [])

    except requests.exceptions.HTTPError as e:
        error_msg = str(e)
        try:
            error_detail = e.response.json()
            error_msg = error_detail.get("error", {}).get("message", str(e))
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Groq API error: {error_msg}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=500, detail="Groq API timeout during evaluation")
    except json.JSONDecodeError as e:
        print(f"JSON parse error during evaluation. Raw: {json_text[:500]}")
        raise HTTPException(status_code=500, detail=f"Invalid JSON from LLM evaluator: {e}")


# --- API Endpoints ---

@app.post("/evaluate/single")
async def evaluate_single(req: QuestionEvalRequest):
    """Evaluate a single question (objective or subjective)."""
    question = req.dict()

    if req.questionType in ["MCQ", "TRUE_FALSE", "FILL_BLANK"]:
        result = evaluate_objective(question)
    else:
        # Subjective - use LLM
        evaluations = evaluate_subjective_with_llm([question])
        if evaluations and len(evaluations) > 0:
            eval_result = evaluations[0]
            result = {
                "obtainedMarks": min(eval_result.get("obtainedMarks", 0), req.marks),
                "isCorrect": eval_result.get("obtainedMarks", 0) >= req.marks,
                "isPartial": 0 < eval_result.get("obtainedMarks", 0) < req.marks,
                "feedback": eval_result.get("feedback", ""),
                "keyPoints": eval_result.get("keyPointsCovered", []),
                "missedPoints": eval_result.get("keyPointsMissed", []),
                "confidence": eval_result.get("confidence", 0.5)
            }
        else:
            result = {
                "obtainedMarks": 0,
                "isCorrect": False,
                "isPartial": False,
                "feedback": "Evaluation failed - could not get LLM response",
                "keyPoints": [],
                "missedPoints": [],
                "confidence": 0.0
            }

    return JSONResponse(content={
        "success": True,
        "evaluation": {
            "questionText": req.questionText,
            "questionType": req.questionType,
            "maxMarks": req.marks,
            **result
        }
    })


@app.post("/evaluate/bulk")
async def evaluate_bulk(req: BulkEvalRequest):
    """
    Evaluate a batch of questions - uses exact matching for objective
    and LLM for subjective questions. This is the main endpoint used
    by the frontend for full paper evaluation.
    """
    objective_results = []
    subjective_questions = []
    subjective_indices = []

    # Separate objective and subjective questions
    for i, q in enumerate(req.questions):
        qtype = q.get("questionType", "MCQ").upper()
        if qtype in ["MCQ", "TRUE_FALSE", "FILL_BLANK"]:
            obj_result = evaluate_objective(q)
            objective_results.append((i, {
                "questionNumber": i + 1,
                "questionText": q.get("questionText", ""),
                "questionType": qtype,
                "maxMarks": q.get("marks", 1),
                "correctAnswer": q.get("correctAnswer", ""),
                "studentAnswer": q.get("studentAnswer", ""),
                **obj_result
            }))
        else:
            subjective_questions.append(q)
            subjective_indices.append(i)

    # Evaluate subjective questions with LLM (in batches of 10)
    subjective_results = []
    batch_size = 10

    for batch_start in range(0, len(subjective_questions), batch_size):
        batch = subjective_questions[batch_start:batch_start + batch_size]
        batch_indices = subjective_indices[batch_start:batch_start + batch_size]

        try:
            evaluations = evaluate_subjective_with_llm(batch)

            for j, eval_result in enumerate(evaluations):
                idx = batch_indices[j]
                q = batch[j]
                obtained = min(eval_result.get("obtainedMarks", 0), q.get("marks", 1))
                max_marks = q.get("marks", 1)

                subjective_results.append((idx, {
                    "questionNumber": idx + 1,
                    "questionText": q.get("questionText", ""),
                    "questionType": q.get("questionType", "SHORT"),
                    "maxMarks": max_marks,
                    "correctAnswer": q.get("correctAnswer", ""),
                    "studentAnswer": q.get("studentAnswer", ""),
                    "obtainedMarks": obtained,
                    "isCorrect": obtained >= max_marks,
                    "isPartial": 0 < obtained < max_marks,
                    "feedback": eval_result.get("feedback", ""),
                    "keyPoints": eval_result.get("keyPointsCovered", []),
                    "missedPoints": eval_result.get("keyPointsMissed", []),
                    "confidence": eval_result.get("confidence", 0.5)
                }))

        except Exception as e:
            print(f"LLM evaluation batch failed: {e}")
            # Fallback: give 0 marks with error feedback
            for j, idx in enumerate(batch_indices):
                q = batch[j]
                subjective_results.append((idx, {
                    "questionNumber": idx + 1,
                    "questionText": q.get("questionText", ""),
                    "questionType": q.get("questionType", "SHORT"),
                    "maxMarks": q.get("marks", 1),
                    "correctAnswer": q.get("correctAnswer", ""),
                    "studentAnswer": q.get("studentAnswer", ""),
                    "obtainedMarks": 0,
                    "isCorrect": False,
                    "isPartial": False,
                    "feedback": f"LLM evaluation failed: {str(e)}",
                    "keyPoints": [],
                    "missedPoints": [],
                    "confidence": 0.0
                }))

    # Merge and sort by original index
    all_results = objective_results + subjective_results
    all_results.sort(key=lambda x: x[0])
    final_results = [r[1] for r in all_results]

    # Calculate summary
    total_obtained = sum(r["obtainedMarks"] for r in final_results)
    total_max = sum(r["maxMarks"] for r in final_results)
    full_correct = sum(1 for r in final_results if r["isCorrect"])
    partial_correct = sum(1 for r in final_results if r["isPartial"])
    wrong = sum(1 for r in final_results if not r["isCorrect"] and not r["isPartial"])

    objective_count = len(objective_results)
    subjective_count = len(subjective_results)

    return JSONResponse(content={
        "success": True,
        "results": final_results,
        "summary": {
            "totalQuestions": len(final_results),
            "objectiveCount": objective_count,
            "subjectiveCount": subjective_count,
            "totalMarks": total_max,
            "obtainedMarks": round(total_obtained, 2),
            "percentage": round((total_obtained / total_max * 100) if total_max > 0 else 0, 2),
            "fullCorrect": full_correct,
            "partialCorrect": partial_correct,
            "wrong": wrong
        }
    })


@app.get("/health")
async def health():
    """Health check"""
    api_configured = bool(GROQ_API_KEY)
    return {
        "status": "healthy" if api_configured else "needs_api_key",
        "groq_api_configured": api_configured,
        "model": GROQ_EVAL_MODEL,
        "service": "LLM Subjective Answer Evaluator"
    }


if __name__ == "__main__":
    import uvicorn

    print("\n" + "=" * 50)
    print("LLM Subjective Answer Evaluator")
    print(f"Model: {GROQ_EVAL_MODEL}")
    print("=" * 50)
    print("Endpoints:")
    print("  POST /evaluate/single  - Evaluate single question")
    print("  POST /evaluate/bulk    - Evaluate batch of questions")
    print("  GET  /health           - Health check")
    print("=" * 50)

    if not GROQ_API_KEY:
        print("\nWARNING: Set GROQ_API_KEY environment variable!")
        print("   Get free key: https://console.groq.com/keys")

    print("\n")
    uvicorn.run(app, host="0.0.0.0", port=8002)
