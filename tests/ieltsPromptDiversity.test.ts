import { describe, expect, it } from 'vitest';
import { buildGeneratorPrompt, type IeltsGenerationContext } from '../src/services/ieltsQuestionGenerator';

const context: IeltsGenerationContext = {
  id: 'internal-test-generation-id',
  createdAt: '2026-11-16T12:00:00.000Z',
  preferredAngles: [
    'community life and local services',
    'objects people keep, repair or pass on',
    'public spaces and the built environment',
    'consumer choices and the life of products',
    'learning methods and practical skills'
  ],
  part1Topics: ['Hometown', 'Work and study'],
  cueCardType: 'object',
  part3Angles: ['changes across generations', 'economic pressures and consumer choices']
};

describe('IELTS generation prompt diversity', () => {
  it('uses preferredAngles as concrete Part 2 inspiration without changing Part 1 assignments', () => {
    const prompt = buildGeneratorPrompt([], [], '', context);

    expect(prompt.system).toContain('CREATIVE DIVERSITY LENSES');
    expect(prompt.system).toContain('community life and local services');
    expect(prompt.system).toContain('objects people keep, repair or pass on');
    expect(prompt.system).toContain('Part 1 topic A: "Hometown"');
    expect(prompt.system).toContain('Part 1 topic B: "Work and study"');
    expect(prompt.system).toContain('cue-card type: object');
    expect(prompt.system).toContain('changes across generations');
    expect(prompt.system).not.toContain('internal-test-generation-id');
    expect(prompt.system).not.toContain('2026-11-16T12:00:00.000Z');
  });

  it('keeps a user-selected theme in control instead of forcing random creative lenses', () => {
    const prompt = buildGeneratorPrompt([], [], 'Community repair cafés', context);

    expect(prompt.system).toContain('USER-SELECTED THEME FOR PARTS 2 & 3: "Community repair cafés"');
    expect(prompt.system).not.toContain('CREATIVE DIVERSITY LENSES');
    expect(prompt.system).toContain('Part 1 topic A: "Hometown"');
    expect(prompt.system).toContain('Part 1 topic B: "Work and study"');
  });

  it('keeps the user prompt concise and avoids repeating the full system instructions', () => {
    const prompt = buildGeneratorPrompt([], [], '', context);

    expect(prompt.user).toContain('Follow every assignment');
    expect(prompt.user).toContain('return only the requested JSON');
    expect(prompt.user.length).toBeLessThan(250);
    expect(prompt.user).not.toContain('Part 1: exactly 2');
    expect(prompt.user).not.toContain('Generation ID');
  });
});
