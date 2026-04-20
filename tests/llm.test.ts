import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock for messages.create — declared at module scope so tests can access it.
const mockCreate = vi.fn();

// Mock the Anthropic SDK before importing the module under test.
// The default export must be a class (constructor), not an arrow function.
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Import after mock is registered.
import { guessReceiptCode } from '../src/llm.js';

beforeEach(() => {
  mockCreate.mockReset();
});

describe('guessReceiptCode', () => {
  it('returns description and confidence when model gives a clean response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: "Ladies' pants or trousers — clothing department item.\nMEDIUM",
        },
      ],
    });

    const result = await guessReceiptCode('fake-key', 'Ross', 'PANTS LADIES');
    expect(result).not.toBeNull();
    expect(result?.description).toBe("Ladies' pants or trousers — clothing department item.");
    expect(result?.confidence).toBe('medium');
  });

  it('returns description without confidence when model omits rating', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Home goods department item.' }],
    });

    const result = await guessReceiptCode('fake-key', 'Target', 'DEPT 42');
    expect(result?.description).toBe('Home goods department item.');
    expect(result?.confidence).toBeUndefined();
  });

  it('returns null when model says Unknown', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Unknown\nLOW' }],
    });

    const result = await guessReceiptCode('fake-key', 'Mystery Store', 'XYZ-999');
    expect(result).toBeNull();
  });

  it('returns null when response has no text block', async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });

    const result = await guessReceiptCode('fake-key', 'Ross', 'PANTS LADIES');
    expect(result).toBeNull();
  });

  it('passes the correct model and store/code context to the API', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'A thing.\nHIGH' }],
    });

    await guessReceiptCode('test-key', 'Burlington', 'DEPT 10');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Burlington'),
          }),
        ]),
      })
    );
  });

  it('handles multi-line description before confidence rating', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'This is line one of the description.\nThis is line two.\nHIGH',
        },
      ],
    });

    const result = await guessReceiptCode('fake-key', 'TJ Maxx', '284070725');
    expect(result?.description).toBe(
      'This is line one of the description. This is line two.'
    );
    expect(result?.confidence).toBe('high');
  });
});
