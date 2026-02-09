
# import easyocr
# import requests # Required for the Gemini API call
# from fastapi import FastAPI, UploadFile, File, HTTPException
# from fastapi.responses import JSONResponse
# from fastapi.middleware.cors import CORSMiddleware
# import io
# from PIL import Image as PILImage
# import tempfile
# import os
# import json
# import time

# # --- Configuration ---
# # 📌 IMPORTANT: Provide your Gemini API key here
# GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyDi0wg3OCvRvsSH-M1putpE_QbU9K8KmQY") 
# GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent"

# # --- Initialization ---
# try:
#     reader = easyocr.Reader(['en'], gpu=False) 
# except Exception as e:
#     print(f"Error initializing EasyOCR reader: {e}")

# # --- FastAPI Server Setup ---
# app = FastAPI()
# origins = ["*"] 
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=origins,
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # --- OCR Functionality (Same as before) ---

# def extract_text_from_image_buffer(image_buffer: bytes):
#     """Extracts text from an image (bytes) buffer using EasyOCR."""
#     try:
#         image = PILImage.open(io.BytesIO(image_buffer))
        
#         with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp_file:
#             image_path = tmp_file.name
#             image.save(image_path)
            
#         results = reader.readtext(image_path)
#         os.unlink(image_path)

#         full_text = "\n".join([text for (bbox, text, conf) in results])
#         return full_text

#     except Exception as e:
#         print(f"Error during OCR processing: {e}")
#         raise HTTPException(status_code=500, detail=f"OCR processing failed: {e}")

# # --- NEW: Gemini LLM Functionality ---

# def generate_quiz_json(raw_text: str):
#     """Calls Gemini to convert raw text into structured JSON quiz data."""
    
#     if not GEMINI_API_KEY:
#         raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured on the server.")

#     system_prompt = (
#         "You are an expert educational content creator. Your task is to analyze the provided study material "
#         "and generate exactly 5 multiple-choice questions (MCQs). For each question, provide 4 options and the "
#         "correct answer. The response MUST be a single JSON array compliant with the provided schema."
#     )

#     user_query = (
#         f"Generate 5 multiple-choice quiz questions based ONLY on the following material: \n\n"
#         f"--- MATERIAL ---\n{raw_text}\n--- END MATERIAL ---"
#     )
    
#     # Define the strict JSON schema for the quiz structure
#     response_schema = {
#         "type": "ARRAY",
#         "items": {
#             "type": "OBJECT",
#             "properties": {
#                 "question": { "type": "STRING", "description": "The multiple choice question text." },
#                 "options": {
#                     "type": "ARRAY",
#                     "items": { "type": "STRING" },
#                     "description": "An array containing exactly 4 multiple-choice options."
#                 },
#                 "answer": { "type": "STRING", "description": "The correct answer among the options." }
#             },
#             "required": ["question", "options", "answer"],
#             "propertyOrdering": ["question", "options", "answer"]
#         }
#     }

#     payload = {
#         "contents": [{"parts": [{"text": user_query}]}],
#         "systemInstruction": {"parts": [{"text": system_prompt}]},
#         "generationConfig": {
#             "responseMimeType": "application/json",
#             "responseSchema": response_schema
#         }
#     }

#     # Implement exponential backoff for robustness
#     max_retries = 3
#     for attempt in range(max_retries):
#         try:
#             response = requests.post(
#                 f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
#                 headers={"Content-Type": "application/json"},
#                 data=json.dumps(payload)
#             )
#             response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)

#             result = response.json()
#             json_text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '{}')
            
#             # The model returns a string representation of the JSON array, so we must parse it.
#             return json.loads(json_text)

#         except requests.exceptions.RequestException as e:
#             if attempt < max_retries - 1 and (response.status_code == 429 or response.status_code >= 500):
#                 # Retry on rate limit (429) or server errors (5xx)
#                 sleep_time = 2 ** attempt
#                 print(f"API call failed (status: {response.status_code}). Retrying in {sleep_time}s...")
#                 time.sleep(sleep_time)
#                 continue
#             else:
#                 raise HTTPException(status_code=500, detail=f"Gemini API call failed: {e}")
#         except json.JSONDecodeError as e:
#             print(f"JSON Decode Error: {e}. Raw Text: {json_text}")
#             raise HTTPException(status_code=500, detail="LLM output was not valid JSON.")
#         except Exception as e:
#             raise HTTPException(status_code=500, detail=f"An unexpected error occurred during LLM processing: {e}")

# # --- Updated API Endpoint for OCR and LLM ---

# @app.post("/ocr/process-file")
# async def process_file(file: UploadFile = File(...)):
#     """Receives a single file, runs OCR, and then runs the LLM to structure the content."""
    
#     file_extension = file.filename.split('.')[-1].lower()
#     content = await file.read()

#     # 1. OCR (Text Extraction)
#     if file_extension in ['jpg', 'jpeg', 'png']:
#         raw_text = extract_text_from_image_buffer(content)
#     elif file_extension == 'pdf':
#         # Placeholder for PDF text extraction. For now, use a dummy text.
#         raw_text = "The digestive system is a group of organs that work together to convert food into energy and basic nutrients to feed the entire body. Food passes through a long tube inside the body known as the alimentary canal, which runs from the mouth to the anus. The process includes ingestion, digestion, absorption, and excretion. The stomach contains hydrochloric acid, which helps in the breakdown of proteins. The small intestine is the main site of nutrient absorption." 
#     else:
#         raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.filename}")
    
#     # Check if text was actually extracted before calling the LLM
#     if not raw_text or raw_text.startswith("PDF Placeholder"):
#         raise HTTPException(status_code=400, detail="No readable text found in the file or PDF extraction is pending.")

#     # 2. LLM Processing (JSON Generation)
#     quiz_data = generate_quiz_json(raw_text)

#     # 3. Return the structured data
#     return JSONResponse(content={
#         "filename": file.filename,
#         "raw_text": raw_text, # Optional: return raw text for debugging
#         "quiz_data": quiz_data,
#     })



import json
import requests
import os
from io import BytesIO

# --- Configuration ---
# 📌 STEP 1: Replace 'YOUR_VA_API_KEY' with your actual Landing.AI VA API key
VA_API_KEY = 'YOUR_VA_API_KEY' 
# 📌 STEP 2: Replace this with the actual path to your document (PDF, PNG, JPG, etc.)
PDF_PATH = 'YOUR_PATH/TO/YOUR_PDF.pdf' 

# Base headers for Authorization
headers = {"Authorization": f"Basic {VA_API_KEY}"}

# URL endpoints
PARSE_URL = "https://api.va.landing.ai/v1/ade/parse"
EXTRACT_URL = "https://api.va.landing.ai/v1/ade/extract"

# JSON Schema for extracting the structured quiz questions
SCHEMA = {
  "type": "object",
  "title": "Markdown Field Extraction Schema",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "required": [
    "questions"
  ],
  "properties": {
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "title": "Question",
        "required": [
          "question_id",
          "question_text",
          "marks",
          "question_type",
          "options",
          "answer"
        ],
        "properties": {
          "marks": {
            "type": "string",
            "title": "Marks",
            "description": "The marks assigned to the question."
          },
          "question_id": {
            "type": "string",
            "title": "Question ID",
            "description": "A unique identifier for the question, if available."
          },
          "question_text": {
            "type": "string",
            "title": "Question Text",
            "description": "The text of the question."
          },
          "question_type": {
            "type": "string",
            "title": "Question Type",
            "description": "The type of question (e.g., single-choice, multiple-choice, code-output)."
          },
          "options": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "answer": {
            "type": "string"
          }
        },
        "description": "A single quiz question with options and selected answers."
      },
      "title": "Quiz Questions",
      "description": "A list of quiz questions with their options and selected answers."
    }
  },
  "description": "Schema for extracting high-value, structured information from a markdown document containing quiz questions and answers."
}


def extract_structured_data_from_document():
    """
    Sequentially calls the Landing.AI VA API to parse a document into Markdown 
    and then extract structured JSON fields using a predefined schema.
    """
    if VA_API_KEY == 'YOUR_VA_API_KEY':
        print("ERROR: Please update VA_API_KEY with your actual key.")
        return
    
    if not os.path.exists(PDF_PATH):
        print(f"ERROR: Document not found at path: {PDF_PATH}. Please update PDF_PATH.")
        return

    try:
        # --- 1. PARSE Document to Markdown ---
        print(f"1. Parsing document ({PDF_PATH}) to Markdown...")
        with open(PDF_PATH, "rb") as f:
            parse_response = requests.post(
                url=PARSE_URL,
                headers=headers,
                files=[("document", (os.path.basename(PDF_PATH), f, 'application/octet-stream'))],
                data={"model": "dpt-2-latest"}
            )
            parse_response.raise_for_status() 

        markdown_content = parse_response.json().get("markdown")
        if not markdown_content:
            print("ERROR: Parse request successful, but no markdown content was returned.")
            return

        print("   -> Document successfully converted to Markdown.")

        # --- 2. EXTRACT Fields from Markdown using the Schema ---
        print("2. Extracting structured data using JSON schema...")
        
        # The markdown content must be passed as a file-like object in the 'files' parameter
        extract_response = requests.post(
            url=EXTRACT_URL, 
            headers=headers,
            files=[("markdown", BytesIO(markdown_content.encode('utf-8')))],
            data={"schema": json.dumps(SCHEMA)},
        )
        extract_response.raise_for_status()

        # Print the final structured JSON result
        print("   -> Extraction successful. Extracted JSON:")
        print(json.dumps(extract_response.json(), indent=2))
        
    except requests.exceptions.HTTPError as e:
        print(f"\nAPI HTTP Error ({e.response.status_code}): {e}")
        try:
            print("Response body:", e.response.json())
        except:
            print("Response body:", e.response.text)
    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}")

if __name__ == "__main__":
    extract_structured_data_from_document()
