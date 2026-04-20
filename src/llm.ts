import Anthropic from '@anthropic-ai/sdk';

export interface LlmGuess {
  description: string;
  // Confidence is optional; the model may decline to estimate.
  confidence?: 'high' | 'medium' | 'low';
}

// Build a single Anthropic client lazily — callers must supply the API key.
function buildClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

// Ask Claude Haiku for a plain-English description of an unknown receipt code.
// Returns null if the model cannot make a reasonable guess.
// The caller is responsible for showing this as unconfirmed and requiring
// explicit user confirmation before saving to the dictionary.
export async function guessReceiptCode(
  apiKey: string,
  storeName: string,
  code: string
): Promise<LlmGuess | null> {
  const client = buildClient(apiKey);

  // Haiku 4.5 — fast and cheap for a single-sentence classification task.
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: buildPrompt(storeName, code),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return null;

  return parseResponse(textBlock.text);
}

// Prompt engineered to elicit a short, structured plain-text response.
function buildPrompt(storeName: string, code: string): string {
  return `You are helping a user understand a cryptic code or abbreviation printed on a retail receipt.

Store: ${storeName}
Receipt code: ${code}

In 1-2 sentences, describe what this code most likely refers to (e.g. product category, department, item type). If you cannot make a reasonable guess, say "Unknown".

Then on a new line, rate your confidence: HIGH, MEDIUM, or LOW.

Example output:
Ladies' pants or trousers — clothing department item.
MEDIUM`;
}

// Extract description and confidence from the model's free-text response.
function parseResponse(raw: string): LlmGuess | null {
  const lines = raw.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Last line is the confidence rating if it matches known values.
  const lastLine = lines[lines.length - 1].trim().toUpperCase();
  let confidence: LlmGuess['confidence'] | undefined;
  let descriptionLines = lines;

  if (lastLine === 'HIGH' || lastLine === 'MEDIUM' || lastLine === 'LOW') {
    confidence = lastLine.toLowerCase() as LlmGuess['confidence'];
    descriptionLines = lines.slice(0, -1);
  }

  const description = descriptionLines.join(' ').trim();
  if (!description || description.toUpperCase() === 'UNKNOWN') return null;

  return { description, confidence };
}
