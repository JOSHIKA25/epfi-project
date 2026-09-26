import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY is missing');
}

const ai = new GoogleGenAI({
  apiKey,
});

console.log('[Test] Gemini API key found.');
console.log('[Test] Sending request to Gemini...');

try {
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: 'Explain what a digital twin is in 3 simple sentences.',
  });

  console.log('\n[Test] Gemini response:\n');
  console.log(response.text);
} catch (error) {
  console.error('\n[Test] Gemini API error:\n');
  console.error(error);
}