import re
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="MCQ Guard Service", version="1.0.0")


class MCQCandidate(BaseModel):
    questionNumber: Optional[int] = None
    questionType: Optional[str] = "MCQ"
    groqAnswer: Optional[str] = ""
    geminiAnswer: Optional[str] = ""


class MCQGuardRequest(BaseModel):
    candidates: List[MCQCandidate]


def _extract_letters(answer_text: str) -> List[str]:
    if not answer_text:
        return []
    text = str(answer_text).strip()
    if not text:
        return []

    if text == "-":
        return ["-"]

    if re.fullmatch(r"\s*[\(\[]?[A-Da-d][\)\]]?\s*(?:[,/&\s]+\s*[\(\[]?[A-Da-d][\)\]]?\s*)*", text):
        letters = re.findall(r"(?<![A-Za-z0-9])[A-Da-d](?![A-Za-z0-9])", text)
        out = []
        seen = set()
        for l in letters:
            u = l.upper()
            if u not in seen:
                seen.add(u)
                out.append(u)
        return out

    marks = list(re.finditer(r"(?<![A-Za-z0-9])[A-Da-d](?![A-Za-z0-9])", text))
    if not marks:
        return []

    # Prefer latest explicit mark (useful for overwritten answers).
    return [marks[-1].group(0).upper()]


def _is_pattern_noise(value: str) -> bool:
    if not value:
        return False
    ans = value.strip().lower()
    if ans in {"cbdac", "abcd", "abcdcba", "cbadcbad"}:
        return True
    return bool(re.fullmatch(r"[a-d]{4,}", ans))


def _pick_mcq(groq_answer: str, gemini_answer: str) -> str:
    g = (groq_answer or "").strip()
    m = (gemini_answer or "").strip()

    if _is_pattern_noise(g):
        g = ""
    if _is_pattern_noise(m):
        m = ""

    g_letters = _extract_letters(g)
    m_letters = _extract_letters(m)

    if g_letters and m_letters:
        if ",".join(g_letters) == ",".join(m_letters):
            return ",".join(g_letters)
        # Conflict: prefer single clear letter; otherwise prefer groq as base.
        if len(g_letters) == 1 and len(m_letters) > 1:
            return g_letters[0]
        if len(m_letters) == 1 and len(g_letters) > 1:
            return m_letters[0]
        return ",".join(g_letters)
    if g_letters:
        return ",".join(g_letters)
    if m_letters:
        return ",".join(m_letters)

    if g == "-" or m == "-":
        return "-"
    return ""


@app.get("/health")
def health():
    return {"success": True, "service": "mcq-guard", "status": "ok"}


@app.post("/mcq/normalize")
def normalize_mcq_answers(payload: MCQGuardRequest):
    outputs = []
    for item in payload.candidates:
        qtype = (item.questionType or "MCQ").upper()
        if qtype != "MCQ":
            outputs.append({
                "questionNumber": item.questionNumber,
                "answer": item.groqAnswer or ""
            })
            continue
        outputs.append({
            "questionNumber": item.questionNumber,
            "answer": _pick_mcq(item.groqAnswer or "", item.geminiAnswer or "")
        })
    return {"success": True, "results": outputs}


if __name__ == "__main__":
    import uvicorn

    print("Starting MCQ Guard Service on http://0.0.0.0:8003")
    uvicorn.run(app, host="0.0.0.0", port=8003)

