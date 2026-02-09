# import sys
# import os
# import io
# import json
# import requests
# import fitz  # PyMuPDF
# from fpdf import FPDF
# import tempfile

# # ---------------------------
# # CONFIG
# # ---------------------------
# VA_API_KEY = "emI5MjY2YXkzcm94YmdldG1odTRmOlJYOHpLc2pRZUM3MVhNMTlNbjhoRkVuM2s3eURyUWdX"  # Replace with your Landing.ai API key
# HEADERS = {"Authorization": f"Bearer {VA_API_KEY}"}



# # ---------------------------
# # CLI ARGUMENT
# # ---------------------------
# if len(sys.argv) < 2:
#     print("Usage: python landing_ai_extract.py <file_path>")
#     sys.exit(1)

# file_path = sys.argv[1]

# if not os.path.exists(file_path):
#     print(f"Error: file not found → {file_path}")
#     sys.exit(1)

# # ---------------------------
# # CONVERT IMAGE TO PDF (if needed)
# # ---------------------------
# if file_path.lower().endswith((".jpg", ".jpeg", ".png")):
#     print("[INFO] Image detected — converting to temporary PDF...")
#     temp_pdf = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
#     pdf = FPDF()
#     pdf.add_page()
#     pdf.image(file_path, x=10, y=10, w=180)
#     pdf.output(temp_pdf.name)
#     pdf.close()
#     document_path = temp_pdf.name
# else:
#     document_path = file_path

# # ---------------------------
# # QUIZ EXTRACTION SCHEMA
# # ---------------------------
# schema_content = {
#   "type": "object",
#   "title": "Quiz Extraction Schema",
#   "properties": {
#     "questions": {
#       "type": "array",
#       "description": "List of questions extracted from the quiz document.",
#       "items": {
#         "type": "object",
#         "properties": {
#           "question_id": {
#             "type": "string",
#             "description": "Unique ID or number of the question (e.g., Q1, Q2, etc.)"
#           },
#           "marks": {
#             "type": "string",
#             "description": "Marks assigned to this question, if available (e.g., 2 marks)."
#           },
#           "question_text": {
#             "type": "string",
#             "description": "Main text of the question."
#           },
#           "question_type": {
#             "type": "string",
#             "description": "Type of question, e.g., MCQ, True/False, Short Answer, etc."
#           },
#           "options": {
#             "type": "array",
#             "description": "Possible answer options (for multiple-choice questions).",
#             "items": {
#               "type": "string"
#             }
#           },
#           "answer": {
#             "type": "string",
#             "description": "Correct answer if available in the document."
#           }
#         },
#         "required": ["question_text"]
#       }
#     }
#   },
#   "required": ["questions"]
# }

# # ---------------------------
# # STEP 1: Parse document
# # ---------------------------
# print("[STEP 1] Parsing document...")
# url_parse = "https://api.va.landing.ai/v1/ade/parse"

# with open(document_path, "rb") as f:
#     response_parse = requests.post(url_parse, files={"document": f}, headers=HEADERS)

# if response_parse.status_code != 200:
#     print("❌ Parse failed:", response_parse.text)
#     sys.exit(1)

# response_json = response_parse.json()
# markdown = response_json.get("markdown", "")
# chunks = response_json.get("chunks", [])

# if not markdown:
#     print("❌ No markdown content returned — parsing failed.")
#     sys.exit(1)

# print("[OK] Parsed successfully.")

# # ---------------------------
# # STEP 2: Extract fields
# # ---------------------------
# print("[STEP 2] Extracting structured fields...")

# url_extract = "https://api.va.landing.ai/v1/ade/extract"
# files_extract = {"markdown": io.StringIO(markdown)}
# data_extract = {"schema": json.dumps(schema_content)}

# response_extract = requests.post(url_extract, files=files_extract, data=data_extract, headers=HEADERS)

# if response_extract.status_code != 200:
#     print("❌ Extraction failed:", response_extract.text)
#     sys.exit(1)

# response_extraction = response_extract.json()
# extraction = response_extraction.get("extraction", {})
# extraction_metadata = response_extraction.get("extraction_metadata", {})

# print("[OK] Extraction successful.")
# print(json.dumps(extraction, indent=2))
