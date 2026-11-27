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


  it('keeps enough retry headroom to complete five sets after repeated invalid model responses', async () => {
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
      message: 'PASS — five-set retry fixture'
    });

    const subjects = [
      'a volunteer-run repair café',
      'an outdoor science festival',
      'a neighbourhood food library',
      'a small independent cinema',
      'a community bicycle workshop'
    ];
    let calls = 0;
    const retryPrompts: string[] = [];
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => {
      calls++;
      const payload = typeof opts.data === 'string' ? JSON.parse(opts.data) : opts.data;
      const prompt = payload.contents[0].parts[0].text as string;
      if (calls <= 5) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          url: opts.url,
          data: { candidates: [{ content: { parts: [{ text: 'not valid JSON' }] } }] }
        };
      }
      retryPrompts.push(prompt);
      const topicA = prompt.match(/Part 1 topic A: "([^"]+)"/)?.[1];
      const topicB = prompt.match(/Part 1 topic B: "([^"]+)"/)?.[1];
      if (!topicA || !topicB) throw new Error('Could not read the assigned Part 1 topics from the prompt.');
      const subject = subjects[calls - 6];
      const part1QuestionSets = [
        [
          `Which part of ${topicA} attracts your attention?`,
          `Did you take part in ${topicA} when you were younger?`,
          `Would you like to learn a new skill related to ${topicA}?`,
          `How important is ${topicB} in your daily routine?`,
          `Where do people usually encounter ${topicB}?`,
          `Has your opinion of ${topicB} changed recently?`
        ],
        [
          `How do people around you make use of ${topicA}?`,
          `What memories do you associate with ${topicA}?`,
          `Could you imagine teaching someone about ${topicA}?`,
          `What would improve your experience of ${topicB}?`,
          `Are there local traditions involving ${topicB}?`,
          `Would you choose ${topicB} over a similar alternative?`
        ],
        [
          `Is ${topicA} more popular now than it used to be?`,
          `Do you prefer experiencing ${topicA} alone or with others?`,
          `What first introduced you to ${topicA}?`,
          `Which age group seems most interested in ${topicB}?`,
          `How accessible is ${topicB} where you live?`,
          `Would you change anything about ${topicB}?`
        ],
        [
          `What role does ${topicA} play in your community?`,
          `How often do you hear people discussing ${topicA}?`,
          `What would encourage you to explore ${topicA} further?`,
          `Do you think ${topicB} receives enough attention?`,
          `What is the most unusual thing about ${topicB}?`,
          `How might ${topicB} develop over time?`
        ],
        [
          `Which qualities make ${topicA} appealing to you?`,
          `Have you had a memorable experience connected with ${topicA}?`,
          `Would you like to see more opportunities related to ${topicA}?`,
          `Is it easy to find information about ${topicB}?`,
          `What makes ${topicB} different from other options?`,
          `When would you recommend people try ${topicB}?`
        ]
      ];
      const part1Questions = part1QuestionSets[calls - 6].map((question, index) => ({
        topic: index < 3 ? topicA : topicB,
        question
      }));
      const part3QuestionSets = [
        [
          `How could local residents help more people benefit from ${subject}?`,
          `What financial barriers might prevent a place such as ${subject} from surviving?`,
          `Should councils provide public funding for facilities like ${subject}?`,
          `How might digital services change the role of ${subject} in the future?`
        ],
        [
          `Why do neighbourhoods sometimes invest in places like ${subject}?`,
          `What competing demands should planners consider before supporting ${subject}?`,
          `Would private organisations or local authorities manage ${subject} more effectively?`,
          `Could changes in working patterns influence visits to ${subject}?`
        ],
        [
          `In what ways can ${subject} strengthen relationships between different age groups?`,
          `Are community-led places such as ${subject} equally useful in rural areas?`,
          `What environmental concerns should organisers address when developing ${subject}?`,
          `How might younger generations reshape the purpose of ${subject}?`
        ],
        [
          `What could make ${subject} financially sustainable without excluding lower-income visitors?`,
          `How should decision-makers judge whether ${subject} provides enough public value?`,
          `Do digital alternatives reduce the need for physical places like ${subject}?`,
          `Who should be consulted before a neighbourhood changes a facility such as ${subject}?`
        ],
        [
          `How can schools and local groups make better use of ${subject}?`,
          `What risks arise when access to places such as ${subject} depends mainly on private money?`,
          `Could population growth change the services that ${subject} needs to offer?`,
          `Which long-term benefits might justify public investment in ${subject}?`
        ]
      ];
      const plan = {
        part1Topics: [topicA, topicB],
        part1Questions,
        part2CueCard: {
          topic: subject,
          title: subject,
          prompt: `Describe ${subject} and explain what makes it useful to the people nearby.`,
          bullets: ['Where it is located', 'Who usually visits it', 'What people can do there', 'And explain why it is valuable to the community']
        },
        part3Questions: part3QuestionSets[calls - 6].map(question => ({ topic: subject, question }))
      };
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: { candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }
      };
    };

    const sets = await generateIeltsQuestionSets(5, { transport });
    expect(calls).toBe(10);
    expect(sets).toHaveLength(5);
    expect(retryPrompts).toHaveLength(5);
    expect(retryPrompts.every(prompt => prompt.includes('IMPORTANT CORRECTION'))).toBe(true);
  });

});
