// Quick test for Gemini API - trying multiple models
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log("Testing Gemini API...");
console.log("API Key:", GEMINI_API_KEY ? `${GEMINI_API_KEY.substring(0, 10)}...` : "NOT SET");

if (!GEMINI_API_KEY) {
  console.log("❌ GEMINI_API_KEY not found in .env");
  process.exit(1);
}

// Try multiple model names
const modelsToTry = [
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
  "gemini-pro",
  "gemini-1.0-pro"
];

async function testModel(modelName) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent("Say 'Hello' only.");
    const response = await result.response;
    const text = response.text();

    return { success: true, modelName, response: text };
  } catch (error) {
    return { success: false, modelName, error: error.message };
  }
}

async function test() {
  console.log("\nTrying different Gemini models...\n");

  for (const modelName of modelsToTry) {
    console.log(`Testing: ${modelName}...`);
    const result = await testModel(modelName);

    if (result.success) {
      console.log(`✅ SUCCESS! Model "${modelName}" works!`);
      console.log(`   Response: ${result.response.substring(0, 50)}`);
      console.log(`\n🎉 Use this model: "${modelName}"`);
      return modelName;
    } else {
      console.log(`❌ Failed: ${result.error.substring(0, 60)}`);
    }
  }

  console.log("\n❌ No models worked. Your API key may have issues.");
  console.log("   Get a new key at: https://aistudio.google.com/app/apikey");
  return null;
}

test();
