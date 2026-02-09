import easyocr
import requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import io
from PIL import Image as PILImage
import tempfile
import os
import json
import time

# --- Configuration ---
# 📌 IMPORTANT: Set your Gemini API key in your environment variables 
# or replace os.environ.get with your key directly.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyDi0wg3OCvRvsSH-M1putpE_QbU9K8KmQY") 
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent"

# --- Initialization ---
try:
    # Initialize the EasyOCR Reader once globally
    reader = easyocr.Reader(['en'], gpu=False) 
except Exception as e:
    print(f"Error initializing EasyOCR reader: {e}")
    # Consider raising an error or exiting if OCR setup fails

# --- FastAPI Server Setup ---
app = FastAPI()
origins = ["*"] 
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- OCR Functionality ---

def extract_text_from_image_buffer(image_buffer: bytes):
    """Extracts text from an image (bytes) buffer using EasyOCR."""
    try:
        image = PILImage.open(io.BytesIO(image_buffer))
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp_file:
            image_path = tmp_file.name
            image.save(image_path)
            
        results = reader.readtext(image_path)
        os.unlink(image_path)

        full_text = "\n".join([text for (bbox, text, conf) in results])
        return full_text

    except Exception as e:
        print(f"Error during OCR processing: {e}")
        raise HTTPException(status_code=500, detail=f"OCR processing failed: {e}")

# --- Gemini LLM Functionality (DYNAMIC COUNTING) ---

def generate_quiz_json(raw_text: str):
    """Calls Gemini to convert raw text into structured JSON quiz data."""
    
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured on the server.")

    # 📌 FIX: Instruction for dynamic question count (proportional to material length)
    system_prompt = (
        "You are an expert educational content creator. Your task is to analyze the provided study material "
        "and generate multiple-choice questions (MCQs). For each question, provide 4 options and the "
        "correct answer. The number of questions should be proportional to the length and detail of the material. "
        "If the material is very short, generate 1 question. If it is long, generate up to 5 questions. "
        "The response MUST be a single JSON array compliant with the provided schema."
    )

    user_query = (
        f"Generate multiple-choice quiz questions based ONLY on the following material: \n\n"
        f"--- MATERIAL ---\n{raw_text}\n--- END MATERIAL ---"
    )
    
    # Define the strict JSON schema for the quiz structure
    response_schema = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "question": { "type": "STRING", "description": "The multiple choice question text." },
                "options": {
                    "type": "ARRAY",
                    "items": { "type": "STRING" },
                    "description": "An array containing exactly 4 multiple-choice options."
                },
                "answer": { "type": "STRING", "description": "The correct answer among the options." }
            },
            "required": ["question", "options", "answer"],
            "propertyOrdering": ["question", "options", "answer"]
        }
    }

    payload = {
        "contents": [{"parts": [{"text": user_query}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": response_schema
        }
    }

    # Implement exponential backoff for robustness
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = requests.post(
                f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
                headers={"Content-Type": "application/json"},
                data=json.dumps(payload)
            )
            response.raise_for_status() 

            result = response.json()
            json_text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '{}')
            
            # The model returns a string representation of the JSON array, so we must parse it.
            return json.loads(json_text)

        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1 and (response.status_code == 429 or response.status_code >= 500):
                sleep_time = 2 ** attempt
                print(f"API call failed (status: {response.status_code}). Retrying in {sleep_time}s...")
                time.sleep(sleep_time)
                continue
            else:
                raise HTTPException(status_code=500, detail=f"Gemini API call failed: {e}")
        except json.JSONDecodeError as e:
            print(f"JSON Decode Error: {e}. Raw Text: {json_text}")
            raise HTTPException(status_code=500, detail="LLM output was not valid JSON.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"An unexpected error occurred during LLM processing: {e}")

# --- Updated API Endpoint for OCR and LLM ---

@app.post("/ocr/process-file")
async def process_file(file: UploadFile = File(...)):
    """Receives a single file, runs OCR, and then runs the LLM to structure the content."""
    
    file_extension = file.filename.split('.')[-1].lower()
    content = await file.read()

    # 1. OCR (Text Extraction)
    if file_extension in ['jpg', 'jpeg', 'png']:
        raw_text = extract_text_from_image_buffer(content)
    elif file_extension == 'pdf':
        # Placeholder for PDF text extraction. For now, use a simple text block.
        raw_text = "The quick brown fox jumps over the lazy dog." 
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.filename}")
    
    # Check if text was actually extracted before calling the LLM
    if not raw_text or len(raw_text.strip()) < 10: # Minimum text length check
        raise HTTPException(status_code=400, detail="No sufficient readable text found in the file.")

    # 2. LLM Processing (JSON Generation)
    quiz_data = generate_quiz_json(raw_text)

    # 3. Return the structured data
    return JSONResponse(content={
        "filename": file.filename,
        "raw_text": raw_text, 
        "quiz_data": quiz_data, # Node.js controller reads the length of this array
    })