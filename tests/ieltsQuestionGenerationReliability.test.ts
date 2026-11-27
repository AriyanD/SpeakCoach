import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseLlmSessionPlanResponse,
  generateIeltsQuestionSets,
  type IeltsGenerationContext
} from '../src/services/ieltsQuestionGenerator';
import {
  clearSeenQuestions,
  getLlmSeenTopics,
  getRecentLlmQuestions
} from '../src/services/ieltsQuestionTracker';
import { saveSlotConfig, saveSlotConnectionTestResult } from '../src/storage/localStore';
import { saveApiKey } from '../src/storage/keyStore';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import { networkMonitor } from '../src/services/networkMonitor';
import type { HttpOptions, HttpResponse } from '@capacitor/core';

const context: IeltsGenerationContext = {
  id: 'test-generation',
  createdAt: '2026-11-16T00:00:00.000Z',
  preferredAngles: ['community life'],
  part1Topics: ['Architecture', 'Urban Living'],
  cueCardType: 'place',
  part3Angles: ['changes across generations', 'public services']
};

const validPlan = {
  part1Topics: ['Architecture', 'Urban Living'],
  part1Questions: [
    { topic: 'Architecture', question: 'What kind of buildings do you enjoy looking at?' },
    { topic: 'Architecture', question: 'Are historic buildings common where you live?' },
    { topic: 'Architecture', question: 'Would you like to design a building?' },
    { topic: 'Urban Living', question: 'What do you like about living in a city?' },
    { topic: 'Urban Living', question: 'How do people usually travel around your city?' },
    { topic: 'Urban Living', question: 'Would you prefer to live somewhere quieter?' }
  ],
  part2CueCard: {
    topic: 'Urban Living',
    title: 'A city that impressed you',
    prompt: 'Describe a city that made a strong impression on you.',
    bullets: ['Where it is', 'When you visited', 'What you did there', 'And explain why it impressed you']
  },
  part3Questions: [
    { topic: 'Urban Living', question: 'Why do many people move from small towns to large cities?' },
    { topic: 'Urban Living', question: 'How can local authorities improve public spaces?' },
    { topic: 'Urban Living', question: 'Do cities offer equal opportunities to all residents?' },
    { topic: 'Urban Living', question: 'How might urban life change over the next few decades?' }
  ]
};

describe('IELTS generation reliability validation', () => {
  beforeEach(() => {
    localStorage.clear();
    clearSeenQuestions();
    clearAllRuntimeFailures();
    networkMonitor.setOnline(true);
  });

  it('accepts the two assigned Part 1 topics and canonicalizes their labels', () => {
    const response = structuredClone(validPlan);
    response.part1Questions[0].topic = 'Your architecture';
    const plan = parseLlmSessionPlanResponse(JSON.stringify(response), {
      generationContext: context,
      persistMemory: false
    });

    expect(plan.part1Topics).toEqual(context.part1Topics);
    expect(plan.part1Questions[0].topic).toBe('Architecture');
    expect(getLlmSeenTopics()).toEqual([]);
    expect(getRecentLlmQuestions()).toEqual([]);
  });

  it('rejects a model that substitutes unassigned Part 1 topics', () => {
    const response = structuredClone(validPlan);
    response.part1Questions = response.part1Questions.map(question => ({
      ...question,
      topic: 'Food and cooking'
    }));

    expect(() => parseLlmSessionPlanResponse(JSON.stringify(response), {
      generationContext: context,
      persistMemory: false
    })).toThrow(/Part 1 topic mismatch/i);
  });

  it('rejects a question that closely repeats recent generation history', () => {
    expect(() => parseLlmSessionPlanResponse(JSON.stringify(validPlan), {
      generationContext: context,
      recentQuestions: ['Why do many people move from small towns to large cities?'],
      persistMemory: false
    })).toThrow(/repeats or closely paraphrases/i);
  });

  it('does not persist history when parsing is explicitly deferred', () => {
    const plan = parseLlmSessionPlanResponse(JSON.stringify(validPlan), {
      persistMemory: false
    });

    expect(plan.part1Questions).toHaveLength(6);
    expect(getLlmSeenTopics()).toEqual([]);
    expect(getRecentLlmQuestions()).toEqual([]);
  });
  it('retries malformed batch responses and commits anti-repeat memory only after the full batch is saved', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    });
    await saveApiKey('llm_generator', 'gemini_gen', 'test-generator-key');
    await saveSlotConnectionTestResult('llm_generator', {
      ok: true,
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      tier: 1,
      label: 'Online AI',
      latencyMs: 1,
      message: 'PASS — reliability fixture'
    });

    let calls = 0;
    const memorySnapshots: string[][] = [];
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => {
      calls++;
      memorySnapshots.push([...getLlmSeenTopics()]);
      if (calls === 1 || calls === 3) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          url: opts.url,
          data: { candidates: [{ content: { parts: [{ text: 'not valid JSON' }] } }] }
        };
      }

      const payload = typeof opts.data === 'string' ? JSON.parse(opts.data) : opts.data;
      const prompt = payload.contents[0].parts[0].text as string;
      const topicA = prompt.match(/Part 1 topic A: "([^"]+)"/)?.[1];
      const topicB = prompt.match(/Part 1 topic B: "([^"]+)"/)?.[1];
      if (!topicA || !topicB) throw new Error('Could not read the assigned Part 1 topics from the prompt.');
      const alternate = calls >= 4;
      const part1Questions = alternate ? [
          { topic: topicA, question: `Which aspects of ${topicA} appeal to you most?` },
          { topic: topicA, question: `Did you take part in ${topicA} activities when you were younger?` },
          { topic: topicA, question: `In what ways has your view of ${topicA} developed?` },
          { topic: topicB, question: `What would you say is the main attraction of ${topicB}?` },
          { topic: topicB, question: `How did you first become interested in ${topicB}?` },
          { topic: topicB, question: `Would you consider exploring ${topicB} in greater depth?` }
        ] : [
          { topic: topicA, question: `What do you enjoy about ${topicA}?` },
          { topic: topicA, question: `How often do you take part in ${topicA}?` },
          { topic: topicA, question: `Has your interest in ${topicA} changed over time?` },
          { topic: topicB, question: `What do you find interesting about ${topicB}?` },
          { topic: topicB, question: `When did you last experience ${topicB}?` },
          { topic: topicB, question: `Would you like to learn more about ${topicB}?` }
        ];
      const part3Questions = alternate ? [
          { topic: topicB, question: `What factors explain the growing interest in ${topicB}?` },
          { topic: topicB, question: `In what ways could communities make ${topicB} more accessible?` },
          { topic: topicB, question: `To what extent should public authorities support ${topicB}?` },
          { topic: topicB, question: `What might happen to ${topicB} as society changes?` }
        ] : [
          { topic: topicB, question: `How can local communities support ${topicB}?` },
          { topic: topicB, question: `What changes might affect ${topicB} in the future?` },
          { topic: topicB, question: `Should public authorities invest more in ${topicB}?` },
          { topic: topicB, question: `How does ${topicB} influence people's quality of life?` }
        ];
      const plan = {
        part1Topics: [topicA, topicB],
        part1Questions,
          { topic: topicA, question: `What do you enjoy about ${topicA}?` },
          { topic: topicA, question: `How often do you take part in ${topicA}?` },
          { topic: topicA, question: `Has your interest in ${topicA} changed over time?` },
          { topic: topicB, question: `What do you find interesting about ${topicB}?` },
          { topic: topicB, question: `When did you last experience ${topicB}?` },
          { topic: topicB, question: `Would you like to learn more about ${topicB}?` }
        ],
        part2CueCard: {
          topic: topicB,
          title: `An experience related to ${topicB}`,
          prompt: `Describe an experience related to ${topicB}.`,
          bullets: ['When it happened', 'Where you were', 'What you did', 'And explain why you remember it']
        },
        part3Questions
      };
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: { candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }
      };
    };

    const sets = await generateIeltsQuestionSets(2, { transport });
    expect(calls).toBe(4);
    expect(sets).toHaveLength(2);
    expect(memorySnapshots).toHaveLength(4);
    expect(memorySnapshots.every(snapshot => snapshot.length === 0)).toBe(true);
    expect(getLlmSeenTopics().length).toBeGreaterThan(0);
    expect(getRecentLlmQuestions().length).toBeGreaterThan(0);
  });

});
