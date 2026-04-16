const normalizeUnicode = (value = "") => String(value ?? "").normalize("NFKC");

export const roundToHalf = (value) => Math.round(Number(value || 0) * 2) / 2;

export const cleanText = (text) =>
  normalizeUnicode(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const normalizeCompactText = (text) =>
  cleanText(text)
    .replace(/^option\s*[a-e][\)\].:\-\s]*/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const normalizeSemanticText = (text) =>
  cleanText(text)
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (text) =>
  normalizeSemanticText(text)
    .split(/\s+/)
    .filter((token) => token && (token.length > 1 || /^[a-z0-9]$/i.test(token)));

const hasCriticalShortToken = (tokens) =>
  tokens.some((token) => token.length === 1 || /\d/.test(token));

export const parseNumericExpression = (value) => {
  if (value === null || value === undefined) return null;
  const raw = normalizeUnicode(value).trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, "");
  if (/^[-+]?(\d+(\.\d+)?|\.\d+)([%a-zA-Z]+)?$/.test(compact)) {
    const numeric = compact.match(/[-+]?(\d+(\.\d+)?|\.\d+)/);
    return numeric ? Number(numeric[0]) : null;
  }

  if (/^[\d+\-*/().\s]+$/.test(raw)) {
    try {
      const valueFn = Function(`"use strict"; return (${raw});`);
      const evaluated = Number(valueFn());
      return Number.isFinite(evaluated) ? evaluated : null;
    } catch {
      return null;
    }
  }

  const leading = raw.match(/[-+]?(\d+(\.\d+)?|\.\d+)/);
  return leading ? Number(leading[0]) : null;
};

export const isNumericLike = (value) => parseNumericExpression(value) !== null;

export const isNumericallyEqual = (a, b, tolerance = 0.01) => {
  const left = parseNumericExpression(a);
  const right = parseNumericExpression(b);
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= tolerance;
};

export const isNumericallyClose = (a, b, tolerancePercent = 5) => {
  const left = parseNumericExpression(a);
  const right = parseNumericExpression(b);
  if (left === null || right === null) return false;
  if (right === 0) return Math.abs(left) <= 0.01;
  return (Math.abs(left - right) / Math.abs(right)) * 100 <= tolerancePercent;
};

export const extractMcqChoices = (answer) => {
  if (!answer) return [];
  const text = normalizeUnicode(answer).trim().toUpperCase();
  if (!text || text === "-") return [];

  const strictPattern = /^\s*[\(\[]?[A-E][\)\]]?\s*(?:[,/&\s]+\s*[\(\[]?[A-E][\)\]]?\s*)*$/;
  if (strictPattern.test(text)) {
    return [...new Set(text.match(/(?<![A-Z0-9])[A-E](?![A-Z0-9])/g) || [])];
  }

  const standalone = text.match(/(?<![A-Z0-9])[A-E](?![A-Z0-9])/g) || [];
  if (standalone.length === 1 && text.length <= 6) return [standalone[0]];
  return [];
};

export const isValidMcqAnswer = (answer) => extractMcqChoices(answer).length > 0;

export const sanitizeMcqAnswer = (answer) => {
  const choices = extractMcqChoices(answer);
  return choices.length ? choices.join(",") : "";
};

export const semanticEquivalent = (studentAnswer, keyAnswer) => {
  const studentCompact = normalizeCompactText(studentAnswer);
  const keyCompact = normalizeCompactText(keyAnswer);
  if (!studentCompact || !keyCompact) return false;
  if (studentCompact === keyCompact) return true;
  if (studentCompact.includes(keyCompact) || keyCompact.includes(studentCompact)) return true;

  const studentSemantic = normalizeSemanticText(studentAnswer);
  const keySemantic = normalizeSemanticText(keyAnswer);
  if (!studentSemantic || !keySemantic) return false;
  if (studentSemantic === keySemantic) return true;
  if (studentSemantic.includes(keySemantic) || keySemantic.includes(studentSemantic)) return true;

  const studentTokens = tokenize(studentAnswer);
  const keyTokens = tokenize(keyAnswer);
  if (!studentTokens.length || !keyTokens.length) return false;

  // Technical answers like "1 persistent", "p persistent", "a protocol"
  // should not pass unless their short/significant tokens also match exactly.
  if (hasCriticalShortToken(keyTokens) || hasCriticalShortToken(studentTokens)) {
    if (studentTokens.length !== keyTokens.length) return false;
    return keyTokens.every((token, index) => studentTokens[index] === token);
  }

  const matches = keyTokens.filter((token) =>
    studentTokens.some((studentToken) => studentToken === token || studentToken.includes(token) || token.includes(studentToken))
  ).length;

  return matches / keyTokens.length >= 0.8;
};

export const gradeMcqAnswer = (keyAnswer, studentAnswer, marks) => {
  const correctChoices = extractMcqChoices(keyAnswer);
  const selectedChoices = extractMcqChoices(studentAnswer);
  const maxMarks = Number(marks) || 0;

  if (!selectedChoices.length) {
    return { obtained: 0, feedback: "No valid MCQ answer provided.", normalizedStudentAnswer: "" };
  }

  if (!correctChoices.length) {
    return { obtained: 0, feedback: "Answer key has no valid MCQ option.", normalizedStudentAnswer: selectedChoices.join(",") };
  }

  const correctSelected = selectedChoices.filter((choice) => correctChoices.includes(choice)).length;
  const wrongSelected = selectedChoices.filter((choice) => !correctChoices.includes(choice)).length;

  if (!correctSelected) {
    return { obtained: 0, feedback: "Incorrect option selected.", normalizedStudentAnswer: selectedChoices.join(",") };
  }

  if (wrongSelected === 0 && correctSelected === correctChoices.length && selectedChoices.length === correctChoices.length) {
    return { obtained: maxMarks, feedback: "Correct.", normalizedStudentAnswer: selectedChoices.join(",") };
  }

  const scoreRatio = Math.max(0, (correctSelected - wrongSelected) / correctChoices.length);
  return {
    obtained: roundToHalf(scoreRatio * maxMarks),
    feedback: wrongSelected > 0 ? "Partially correct, but extra option(s) were selected." : "Partially correct.",
    normalizedStudentAnswer: selectedChoices.join(",")
  };
};

export const fastGradeShortText = (keyAnswer, studentAnswer, marks) => {
  const maxMarks = Number(marks) || 0;
  const studentClean = cleanText(studentAnswer);
  const keyClean = cleanText(keyAnswer);

  if (!studentClean) {
    return { resolved: true, obtained: 0, feedback: "No answer provided." };
  }

  if (normalizeCompactText(studentAnswer) === normalizeCompactText(keyAnswer)) {
    return { resolved: true, obtained: maxMarks, feedback: "Correct." };
  }

  if (isNumericLike(studentAnswer) && isNumericLike(keyAnswer)) {
    if (isNumericallyEqual(studentAnswer, keyAnswer) || isNumericallyClose(studentAnswer, keyAnswer)) {
      return { resolved: true, obtained: maxMarks, feedback: "Correct numerical value." };
    }
    if (maxMarks <= 1) {
      return { resolved: true, obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
    }
    return { resolved: false, obtained: 0, feedback: "Numeric answer needs deeper evaluation." };
  }

  if (keyClean.includes(",") || studentClean.includes(",")) {
    const studentParts = studentClean.split(",").map((part) => part.trim()).filter(Boolean);
    const keyParts = keyClean.split(",").map((part) => part.trim()).filter(Boolean);
    const sameCount = studentParts.length === keyParts.length && studentParts.length > 0;
    if (sameCount) {
      const allMatch = studentParts.every((part, index) => {
        const keyPart = keyParts[index];
        return normalizeCompactText(part) === normalizeCompactText(keyPart) ||
          (isNumericLike(part) && isNumericLike(keyPart) && (isNumericallyEqual(part, keyPart) || isNumericallyClose(part, keyPart)));
      });
      if (allMatch) {
        return { resolved: true, obtained: maxMarks, feedback: "All values are correct." };
      }
    }
  }

  if (semanticEquivalent(studentAnswer, keyAnswer)) {
    return { resolved: true, obtained: maxMarks, feedback: "Correct answer." };
  }

  if (maxMarks <= 1 && tokenize(keyAnswer).length <= 3) {
    return { resolved: true, obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
  }

  return { resolved: false, obtained: 0, feedback: "Needs semantic evaluation." };
};

export const gradeTrueFalseAnswer = (keyAnswer, studentAnswer, marks) => {
  const extractTrueFalse = (text) => {
    const value = cleanText(text);
    if (!value) return { choice: "", justification: "" };
    if (value.startsWith("true") || value === "t") return { choice: "true", justification: value.replace(/^(true|t)\b[\s:;,\-.]*/i, "").trim() };
    if (value.startsWith("false") || value === "f") return { choice: "false", justification: value.replace(/^(false|f)\b[\s:;,\-.]*/i, "").trim() };
    return { choice: "", justification: value };
  };

  const maxMarks = Number(marks) || 0;
  const key = extractTrueFalse(keyAnswer);
  const student = extractTrueFalse(studentAnswer);

  if (!student.choice) return { obtained: 0, feedback: "No True/False answer provided." };
  if (!key.choice || student.choice !== key.choice) return { obtained: 0, feedback: `Incorrect. Expected ${key.choice || "N/A"}.` };

  if (!key.justification) return { obtained: maxMarks, feedback: "Correct." };
  if (!student.justification) return { obtained: roundToHalf(maxMarks / 2), feedback: "Correct choice, but justification is missing." };

  if (semanticEquivalent(student.justification, key.justification)) {
    return { obtained: maxMarks, feedback: "Correct with justification." };
  }

  return { obtained: roundToHalf(maxMarks / 2), feedback: "Correct choice, but justification is only partially matched." };
};

export const shouldRetryExtraction = (answers = []) => {
  const mcqAnswers = answers.filter((answer) => String(answer.questionType || "").toUpperCase() === "MCQ");
  if (!mcqAnswers.length) return { retry: false, emptyCount: 0, validRatio: 1 };

  const invalidOrEmpty = mcqAnswers.filter((answer) => !sanitizeMcqAnswer(answer.answer || answer.Answer || "")).length;
  const validRatio = (mcqAnswers.length - invalidOrEmpty) / mcqAnswers.length;

  return {
    retry: invalidOrEmpty > 3 || validRatio < 0.8,
    emptyCount: invalidOrEmpty,
    validRatio
  };
};
