# MCQ Groq Extraction - Troubleshooting Guide

## Symptom: Still seeing lowercase letters

**Symptoms:**
```
Diagnostic output shows:
❌ Lowercase Answers Found: 3
  Q7: "b" should be "B"
```

**Cause:** You haven't applied the fixes yet, OR you ran `npm run fix-mcq` (dry run only)

**Fix:**
```bash
# Option 1: Apply the fixes
npm run fix-mcq:apply

# Option 2: Verify what will be fixed first
npm run fix-mcq              # Shows preview
npm run fix-mcq:apply       # Actually applies
```

**Verify it worked:**
```bash
npm run diagnose-mcq
# Should now show: Lowercase Answers Found: 0 ✅
```

---

## Symptom: Still seeing inconsistent answers

**Symptoms:**
```
Diagnostic output shows:
❌ Inconsistencies Found: 2
  Q7: Found 2 extractions with different answers: [B, C]
  Q12: Found 3 extractions with different answers: [A, D]
```

**Cause:** These are extracted data issues, not format issues. Same question extracted differently from bridge vs. top/bottom page sections.

**Possible Causes:**
1. Poor image quality in one of the extraction areas
2. Question spans page boundary (appears in 2+ extractions)
3. Groq non-determinism (different AI output for same question)

**Fixes (in order of preference):**

### Option 1: Re-scan the Document
If the mark is unclear in the original paper:
```bash
1. Re-scan/photograph the exam with better lighting
2. Re-upload the PDF
3. Run diagnose again: npm run diagnose-mcq
```

### Option 2: Manual Override
For critical exams, manually check and override:
```javascript
// In Node.js
await Quiz.updateOne(
  { _id: quizId, "questions.questionNumber": 7 },
  { $set: { "questions.$.Answer": "B" } }
);
```

### Option 3: Accept the Uncertainty
If question is on page boundary, some inconsistency is expected:
```bash
# Document that Q7 is uncertain
# Add note to grading system
# Manual review for this question
```

---

## Symptom: Empty answers not being fixed

**Symptoms:**
```
Diagnostic output shows:
❌ Empty Answers Found: 5
  Q15: No answer extracted
```

**This is NOT a bug.** Empty answers mean:
- Student didn't mark that question, OR
- Handwriting is too faint to extract

**What to do:**

### If student DID mark the answer:
1. Check original paper - is the mark visible?
2. If visible, re-scan with better lighting/contrast
3. Re-upload the PDF

### If student DIDN'T mark the answer:
This is correct extraction. Mark as:
```javascript
// Explicitly no answer
Answer: ""  // or
Answer: "No Answer Provided"  // For tracking
```

### To Identify Why It's Empty:
```bash
# Get the quiz and question
db.quizzes.findOne({file_name: "quiz1.pdf"})
# Manually look at the original PDF
# Check if Q15 has any mark visible
```

---

## Symptom: Diagnostic script crashes

**Error:**
```
$ npm run diagnose-mcq
Error: connect ECONNREFUSED 127.0.0.1:27017
```

**Cause:** MongoDB not running or connection string wrong

**Fix:**

### Check MongoDB is Running
```bash
# Mac with Homebrew
brew services list | grep mongodb

# Windows (check Services app)

# Linux
sudo systemctl status mongod

# Docker
docker ps | grep mongo
```

### Check Connection String
```bash
# In .env file
MONGODB_URI=mongodb://localhost:27017/quiz_db

# Should match your MongoDB:
# - Host: localhost (or your server IP)
# - Port: 27017 (default MongoDB port)
# - Database: quiz_db (or your database name)
```

### Start MongoDB if Stopped
```bash
# Mac
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Docker
docker run -d -p 27017:27017 --name mongo mongo:latest
```

### Try Again
```bash
npm run diagnose-mcq
```

---

## Symptom: Models not found error

**Error:**
```
Error: Cannot find module '../models/quiz_new.js'
```

**Cause:** Quiz model path is wrong

**Fix:**
```bash
# Check models exist
ls -la Server/models/

# Should show:
# - quiz_new.js
# - QuestionBank.js
# - Result.js
# - etc.

# If missing, restore from git
git checkout Server/models/quiz_new.js
```

---

## Symptom: Fix script says "0 fixes applied"

**Symptoms:**
```
$ npm run fix-mcq
=== Summary ===
Fixes Applied: 0
```

**Cause:** Either:
1. Your data is already clean, OR
2. Questions were stored with uppercase already

**Verification:**
```bash
# Check database directly
# Look for questions with lowercase answers
db.quiz1s.find({"questions.Answer": /^[a-d]$/})

# If nothing found, you're good!
# If found, might be a data model issue
```

---

## Symptom: "Permission denied" when running npm scripts

**Error:**
```
$ npm run fix-mcq:apply
Error: EACCES: permission denied
```

**Cause:** Running without proper permissions

**Fix:**

### On Mac/Linux:
```bash
# Option 1: Use sudo (not recommended)
sudo npm run fix-mcq:apply

# Option 2: Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH

# Then try again
npm run fix-mcq:apply
```

### On Windows:
```powershell
# Run Command Prompt as Administrator
# Then try again
npm run fix-mcq:apply
```

---

## Symptom: Getting inconsistent results on re-run

**Symptoms:**
```
$ npm run diagnose-mcq
Inconsistencies Found: 1

$ npm run diagnose-mcq
Inconsistencies Found: 0  # Different result!
```

**Cause:** This is normal. Different questions are extracted each run (non-deterministic)

**Why it happens:**
- Groq API is probabilistic
- Same input might produce slightly different output
- Random selection might pick different extraction variant

**It's okay because:**
- Deduplication logic handles it
- Answer normalization is deterministic
- Fix script is idempotent (safe to run multiple times)

---

## Symptom: "Rate limit reached" error during extraction

**Error:**
```
❌ Groq API error (status 429): Rate limit reached
```

**Cause:** Hit Groq API rate limit (tokens per minute)

**Fix:**

### Immediate:
Wait and retry. System auto-retries after waiting:
```
⚠️ Rate limited. Waiting 58.2s before retry 2/5...
```

### Long-term Solutions:
1. **Upgrade Groq plan:**
   - Go to https://console.groq.com
   - Upgrade from "Free" to paid tier
   - Increase token limit

2. **Batch uploads:**
   - Don't upload 10 PDFs simultaneously
   - Stagger uploads 1-2 at a time
   - Reduces concurrent token usage

3. **Split large PDFs:**
   - If you have 100-page PDF, split it
   - Upload 10-page chunks
   - Reduces peak token usage

---

## Symptom: Specific question always extracts wrong answer

**Symptoms:**
```
Q7 always extracts: Answer='D'
But it's clearly: Answer='B' in the paper
```

**Cause:** Groq hallucination or misinterpretation

**Diagnosis:**
```bash
# Check original PDF
# Look at Q7 in the original file
# Is the mark clear and dark?

# Check extraction context
# Did Q7 span multiple page sections?
db.quiz1s.findOne({}, {
  "questions": {$elemMatch: {"questionNumber": 7}}
})
```

**Fix (in order of likelihood to help):**

1. **Re-scan with better quality**
   - Better lighting
   - More contrast
   - Higher DPI
   - Re-upload

2. **Manually override**
   ```javascript
   // One-time fix for this question
   db.quiz1s.updateOne(
     {_id: ObjectId("...")},
     {$set: {"questions.7.Answer": "B"}}
   );
   ```

3. **Check if it's a student error**
   - Maybe student actually marked D
   - Double-check with original paper
   - Don't assume extraction is wrong

---

## Symptom: Fix script modifies more questions than I expected

**Symptoms:**
```
Expected 3 fixes, got 10 fixes applied
```

**Cause:** Multiple issues in single answer

Example: Answer='A , C' is actually 3 issues:
1. Lowercase: 'a' → 'A'
2. Extra spaces: 'A , C' → 'A,C'
3. (possibly lowercase 'c' → 'C')

**Verify it's correct:**
```bash
# Before fixing:
Original: 'A , C'

# After fixing:
Fixed: 'A,C'

# This is correct! Both are equivalent.
```

**Doublecheck:**
```bash
# Preview first with dry run
npm run fix-mcq

# Review ALL proposed changes
# Only then run with --apply
npm run fix-mcq:apply
```

---

## Symptom: MongoDB data corruption after fix

**Symptoms:**
```
Data looks corrupted after running fix-mcq:apply
```

**Recovery:**

### Option 1: Rollback
```bash
# If using Git
git reflog
git reset --hard HEAD@{n}

# If using MongoDB backups
mongorestore --uri="mongodb://localhost:27017" /backup/path
```

### Option 2: Manual Fix
```javascript
// Find corrupted records
db.quiz1s.find({"questions.Answer": {$regex: "error"}})

// Manually restore
db.quiz1s.updateOne(
  {_id: ObjectId("...")},
  {$set: {"questions.$.Answer": "correctValue"}}
)
```

### Prevention:
Always run dry-run first:
```bash
npm run fix-mcq              # Preview
npm run fix-mcq:apply       # Only after reviewing preview
```

---

## Symptom: Normalized answers look wrong

**Symptoms:**
```
After normalization:
Q7: "B" (was "b")  ✓ Correct
Q12: "A,C" (was "a,c")  ✓ Correct
Q15: "A,A,C" → "A,C"  ✓ Correct (deduped)
```

All of these are correct! The normalization is working.

---

## General Troubleshooting Checklist

- [ ] MongoDB is running: `npm run diagnose-mcq` should connect
- [ ] .env file exists with `MONGODB_URI` and `GROQ_API_KEY`
- [ ] Models are in place: `ls Server/models/`
- [ ] Run dry-run first: `npm run fix-mcq`
- [ ] Review changes: Check console output carefully
- [ ] Apply fixes: `npm run fix-mcq:apply`
- [ ] Verify: `npm run diagnose-mcq` should show 0 or fewer issues
- [ ] Check original data: Is the paper's answer actually correct?

---

## Emergency: Restore Original Data

```bash
# If everything went wrong:
# Option 1: From backup
mongorestore --drop --uri="mongodb://localhost:27017" /backup/path

# Option 2: From git
git reset --hard HEAD~1

# Option 3: Manual deletion and re-upload
# Delete problematic quizzes
# Re-upload PDFs from original files
```

---

## Still Having Issues?

1. **Check this guide:** Search your symptom above
2. **Check logs:** Run `npm run diagnose-mcq` for detailed output
3. **Check .env:** Verify all environment variables
4. **Check original paper:** Is it actually correct?
5. **Try dry-run:** Preview before applying: `npm run fix-mcq`
6. **Check permissions:** Is MongoDB accessible?

---

## Contact Support

For issues with:
- **Groq API:** Visit https://console.groq.com/docs/api-keys
- **MongoDB:** Check MongoDB docs
- **Node.js:** Verify Node version: `node --version`
- **This code:** Check MCQ_GROQ_FIX_GUIDE.md for details
