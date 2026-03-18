"""
Test script for GROQ OCR extraction
Run this to debug extraction issues

Usage:
    python test_groq.py path/to/your/file.pdf
    python test_groq.py path/to/your/image.jpg
"""

import sys
import requests
import json

def test_extraction(file_path):
    print(f"\n{'='*60}")
    print(f"Testing GROQ extraction for: {file_path}")
    print(f"{'='*60}\n")

    # Make sure the OCR service is running
    try:
        health = requests.get("http://localhost:8001/health", timeout=5)
        print(f"OCR Service Status: {health.json()}")
    except Exception as e:
        print(f"ERROR: OCR service not running on port 8001!")
        print(f"Start it with: python ocr_service_free.py")
        return

    # Send file for extraction
    print(f"\nSending file to OCR service...")
    try:
        with open(file_path, "rb") as f:
            files = {"file": (file_path, f)}
            response = requests.post(
                "http://localhost:8001/ocr/extract",
                files=files,
                timeout=180
            )

        print(f"\nResponse Status: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            print(f"\n{'='*60}")
            print("EXTRACTION SUCCESSFUL!")
            print(f"{'='*60}")

            extraction = data.get("extraction", {})
            doc_info = extraction.get("documentInfo", {})
            questions = extraction.get("questions", [])

            print(f"\nDocument Info:")
            print(f"  Enrollment: {doc_info.get('enrollmentNumber', 'N/A')}")
            print(f"  Date: {doc_info.get('date', 'N/A')}")
            print(f"  Total Marks: {doc_info.get('totalMarks', 'N/A')}")

            print(f"\nTotal Questions: {len(questions)}")
            print(f"\n{'='*60}")
            print("QUESTIONS AND ANSWERS:")
            print(f"{'='*60}")

            for i, q in enumerate(questions):
                print(f"\nQ{i+1}. [{q.get('questionType', 'Unknown')}] (Marks: {q.get('marks', 0)})")
                print(f"    Text: {q.get('questionText', 'N/A')[:100]}...")
                print(f"    Answer: {q.get('Answer', 'No answer')}")

                # Highlight multi-select MCQs
                answer = str(q.get('Answer', ''))
                if q.get('questionType') == 'MCQ' and ',' in answer:
                    print(f"    >>> MULTI-SELECT DETECTED: {answer}")

            # Save full response to file for inspection
            output_file = "extraction_result.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"\n\nFull response saved to: {output_file}")

        else:
            print(f"\nERROR Response:")
            print(response.text)

    except requests.exceptions.Timeout:
        print("ERROR: Request timed out (180s)")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {str(e)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_groq.py <path_to_file>")
        print("Example: python test_groq.py test.pdf")
        sys.exit(1)

    test_extraction(sys.argv[1])
