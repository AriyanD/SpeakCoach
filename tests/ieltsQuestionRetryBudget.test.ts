import { beforeEach, describe, expect, it } from 'vitest';
import { generateIeltsQuestionSets } from '../src/services/ieltsQuestionGenerator';
import { clearSeenQuestions } from '../src/services/ieltsQuestionTracker';
import { saveSlotConfig, saveSlotConnectionTestResult } from '../src/storage/localStore';
import { saveApiKey } from '../src/storage/keyStore';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import { networkMonitor } from '../src/services/networkMonitor';
import type { HttpOptions, HttpResponse } from '@capacitor/core';

const part1Rows = [
  ['Which part of {A} attracts your attention?', 'Did you take part in {A} when you were younger?', 'Would you learn a skill related to {A}?', 'How important is {B} in your daily routine?', 'Where do people encounter {B}?', 'Has your opinion of {B} changed recently?'],
  ['How do people around you use {A}?', 'What memories do you associate with {A}?', 'Could you teach someone about {A}?', 'What would improve your experience of {B}?', 'Are there local traditions involving {B}?', 'Would you choose {B} over an alternative?'],
  ['Is {A} more popular now than before?', 'Do you prefer experiencing {A} alone or with others?', 'What first introduced you to {A}?', 'Which age group is interested in {B}?', 'How accessible is {B} where you live?', 'Would you change anything about {B}?'],
  ['What role does {A} play in your community?', 'How often do people discuss {A}?', 'What would encourage you to explore {A}?', 'Does {B} receive enough attention?', 'What is unusual about {B}?', 'How might {B} develop over time?'],
  ['Which qualities make {A} appealing?', 'Have you had a memorable experience with {A}?', 'Would you like more opportunities related to {A}?', 'Is information about {B} easy to find?', 'What makes {B} different from other options?', 'When would you recommend people try {B}?']
];
const part3Rows = [
  ['How could local residents help more people benefit from {S}?', 'What financial barriers might prevent {S} from surviving?', 'Should councils fund facilities like {S}?', 'How might digital services change the role of {S}?'],
  ['Why do neighbourhoods invest in places like {S}?', 'What competing demands should planners consider before supporting {S}?', 'Would private organisations or local authorities manage {S} better?', 'Could changing work patterns influence visits to {S}?'],
  ['How can {S} strengthen relationships between age groups?', 'Are places such as {S} equally useful in rural areas?', 'What environmental concerns arise when developing {S}?', 'How might younger generations reshape the purpose of {S}?'],
  ['What could make {S} financially sustainable without excluding lower-income visitors?', 'How should decision-makers judge the public value of {S}?', 'Do digital alternatives reduce the need for places like {S}?', 'Who should be consulted before changing a facility such as {S}?'],
  ['How can schools and local groups make better use of {S}?', 'What risks arise when access to {S} depends on private money?', 'Could population growth change the services {S} needs?', 'Which long-term benefits justify public investment in {S}?']
];

describe('IELTS question retry budget', () => {
  beforeEach(() => {
    localStorage.clear();
    clearSeenQuestions();
    clearAllRuntimeFailures();
    networkMonitor.setOnline(true);
  });

  it('completes five sets after five invalid responses using the restored retry headroom', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    });
    await saveApiKey('llm_generator', 'gemini_gen', 'test-generator-key');
    await saveSlotConnectionTestResult('llm_generator', {
      ok: true, slotId: 'llm_generator', providerId: 'gemini_gen',
      tier: 1, label: 'Online AI', latencyMs: 1, message: 'PASS — retry fixture'
    });

    const subjects = [
      'a volunteer-run repair café', 'an outdoor science festival',
      'a neighbourhood food library', 'a small independent cinema',
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
          status: 200, headers: { 'content-type': 'application/json' }, url: opts.url,
          data: { candidates: [{ content: { parts: [{ text: 'not valid JSON' }] } }] }
        };
      }
      retryPrompts.push(prompt);
      const topicA = prompt.match(/Part 1 topic A: "([^"]+)"/)?.[1];
      const topicB = prompt.match(/Part 1 topic B: "([^"]+)"/)?.[1];
      if (!topicA || !topicB) throw new Error('Assigned topics were missing from the prompt.');
      const setIndex = calls - 6;
      const subject = subjects[setIndex];
      const fill = (value: string): string => value
        .replace(/\{A\}/gu, topicA).replace(/\{B\}/gu, topicB).replace(/\{S\}/gu, subject);
      const plan = {
        part1Topics: [topicA, topicB],
        part1Questions: part1Rows[setIndex].map((question, index) => ({
          topic: index < 3 ? topicA : topicB, question: fill(question)
        })),
        part2CueCard: {
          topic: subject, title: subject,
          prompt: `Describe ${subject} and explain what makes it useful to nearby people.`,
          bullets: ['Where it is located', 'Who usually visits it', 'What people can do there', 'And why it is valuable to the community']
        },
        part3Questions: part3Rows[setIndex].map(question => ({ topic: subject, question: fill(question) }))
      };
      return {
        status: 200, headers: { 'content-type': 'application/json' }, url: opts.url,
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
